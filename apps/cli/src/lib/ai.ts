import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { Result } from "better-result";
import { z } from "zod";
import type { FileChange } from "../types";
import {
  loadConfig,
  getApiKey,
  getCustomPrompt,
  getCloudflareConfig,
  getSelectedModel,
  getSelectedProvider,
  getSelectedProviderConfig,
} from "./config";
import { NoApiKeyError, AIApiError } from "./errors";
import { PROVIDER_CONFIG, type ProviderKey } from "./models";
import { getCache, setCache, CacheNamespaces, generateCacheKey } from "./cache";
import { telemetry, categorizeModel, createTimer } from "./telemetry";
import { parseDiffIntoHunks } from "./hunks";
import { classifyFiles } from "./file-classification";

export type AnalysisGroup = {
  name: string;
  description: string;
  files: string[];
  commitMessage?: string;
  fileHunks: Array<{
    path: string;
    lineRanges: Array<{ start: number; end: number }>;
    hunkIndices: number[];
  }>;
  category: string;
  order: number;
};

type ModelAnalysisGroup = {
  name: string;
  description: string;
  hunkIds: string[];
  category: AnalysisGroup["category"];
  order: number;
};

type NormalizedHunkGroup = ModelAnalysisGroup;

type HunkDescriptor = {
  id: string;
  path: string;
  status: FileChange["status"];
  hunkIndex: number;
  newStart: number;
  newEnd: number;
  added: number;
  removed: number;
  changeType: "addition" | "deletion" | "modification" | "mixed";
  preview: string;
  priority: number;
};

type AssetAssignmentSummary = {
  attachedAssetCount: number;
  fallbackAssetCount: number;
};

type CommitMessagePromptDetail = "full" | "compact" | "minimal" | "tiny";

const ANALYSIS_CONTEXT_CHAR_BUDGET = 12000;
const ANALYSIS_INITIAL_HUNK_LIMIT = 120;
const ANALYSIS_MIN_HUNK_LIMIT = 8;
const COMMIT_MESSAGES_CHAR_BUDGET = 8000;
const MAX_ANALYZABLE_FILES_PER_GROUP = 2;

const COMMIT_MESSAGE_DETAIL_CONFIG: Record<
  CommitMessagePromptDetail,
  {
    maxDescriptionChars: number;
    maxFiles: number;
    maxStyleExamples: number;
    includeFiles: boolean;
  }
> = {
  full: {
    maxDescriptionChars: 240,
    maxFiles: 8,
    maxStyleExamples: 5,
    includeFiles: true,
  },
  compact: {
    maxDescriptionChars: 140,
    maxFiles: 4,
    maxStyleExamples: 3,
    includeFiles: true,
  },
  minimal: {
    maxDescriptionChars: 90,
    maxFiles: 2,
    maxStyleExamples: 2,
    includeFiles: true,
  },
  tiny: {
    maxDescriptionChars: 60,
    maxFiles: 0,
    maxStyleExamples: 2,
    includeFiles: false,
  },
};

function countAddedLines(content: string): number {
  return content.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .length;
}

function countRemovedLines(content: string): number {
  return content.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---"))
    .length;
}

function detectChangeType(content: string): HunkDescriptor["changeType"] {
  const added = content.split("\n").some((line) => line.startsWith("+") && !line.startsWith("+++"));
  const removed = content.split("\n").some((line) => line.startsWith("-") && !line.startsWith("---"));
  if (added && removed) return "mixed";
  if (added) return "addition";
  if (removed) return "deletion";
  return "modification";
}

function getPathPriority(path: string): number {
  const lower = path.toLowerCase();
  if (lower.includes("package-lock") || lower.includes("pnpm-lock") || lower.endsWith(".lock")) {
    return -3;
  }
  if (
    lower.includes("dist/") ||
    lower.includes("build/") ||
    lower.includes("coverage/") ||
    lower.includes("node_modules/")
  ) {
    return -3;
  }
  if (lower.includes("readme") || lower.endsWith(".md")) {
    return 0;
  }
  if (lower.includes("test") || lower.includes("spec")) {
    return 1;
  }
  if (lower.includes("src/")) {
    return 3;
  }
  return 2;
}

function inferCategoryFromPath(path: string): AnalysisGroup["category"] {
  const lower = path.toLowerCase();
  if (lower.endsWith(".md") || lower.includes("readme")) return "docs";
  if (lower.includes("test") || lower.includes("spec")) return "test";
  if (lower.includes("fix") || lower.includes("bug")) return "fix";
  if (lower.includes("refactor") || lower.includes("cleanup") || lower.includes("rename")) {
    return "refactor";
  }
  if (lower.includes("package.json") || lower.includes("lock") || lower.includes("wrangler") || lower.includes("workflow")) {
    return "setup";
  }
  if (lower.includes("config") || lower.includes("eslint") || lower.includes("prettier")) {
    return "chore";
  }
  return "feature";
}

function buildHunkDescriptors(
  files: FileChange[],
  diffs: Map<string, string>,
  untrackedContent: Map<string, string>,
): HunkDescriptor[] {
  const descriptors: HunkDescriptor[] = [];

  for (const file of files) {
    const diff = diffs.get(file.path) ?? untrackedContent.get(file.path) ?? "";
    if (!diff) continue;

    if (file.status === "added" && untrackedContent.has(file.path)) {
      const lines = diff.split("\n");
      const preview = lines.slice(0, 12).join("\n");
      descriptors.push({
        id: `${file.path}:hunk-0`,
        path: file.path,
        status: file.status,
        hunkIndex: 0,
        newStart: 1,
        newEnd: Math.max(2, lines.length + 1),
        added: lines.length,
        removed: 0,
        changeType: "addition",
        preview,
        priority: getPathPriority(file.path),
      });
      continue;
    }

    const parsed = parseDiffIntoHunks(diff, file.path, file.status);
    if (parsed.hunks.length === 0) continue;

    for (let i = 0; i < parsed.hunks.length; i++) {
      const hunk = parsed.hunks[i];
      if (!hunk) continue;
      const previewLines = hunk.content
        .split("\n")
        .filter((line) => line.startsWith("+") || line.startsWith("-") || line.startsWith(" "))
        .slice(0, 10)
        .join("\n");

      descriptors.push({
        id: `${file.path}:hunk-${i}`,
        path: file.path,
        status: file.status,
        hunkIndex: i,
        newStart: hunk.newStart,
        newEnd: Math.max(hunk.newStart + 1, hunk.newStart + hunk.newLines),
        added: countAddedLines(hunk.content),
        removed: countRemovedLines(hunk.content),
        changeType: detectChangeType(hunk.content),
        preview: previewLines,
        priority: getPathPriority(file.path),
      });
    }
  }

  return descriptors;
}

function renderHunkContext(
  hunks: HunkDescriptor[],
  mode: "full" | "compact",
  omittedCount: number,
): string {
  const lines: string[] = [];
  lines.push("## Changed Hunks");
  lines.push("");
  lines.push("Use hunk IDs exactly as provided.");
  lines.push("If omitted hunks exist, only reason about shown hunks.");
  lines.push("");

  for (const hunk of hunks) {
    lines.push(
      `- ${hunk.id} | ${hunk.path} | lines ${hunk.newStart}-${hunk.newEnd} | +${hunk.added}/-${hunk.removed} | ${hunk.changeType}`,
    );
    if (mode === "full" && hunk.preview.trim().length > 0) {
      lines.push("```diff");
      lines.push(hunk.preview);
      lines.push("```");
    }
  }

  if (omittedCount > 0) {
    lines.push("");
    lines.push(`Note: ${omittedCount} hunks omitted due to context budget.`);
  }

  return lines.join("\n");
}

function buildFallbackGroupName(path: string): string {
  return `include remaining changes in ${path}`;
}

function buildFallbackGroupDescription(path: string, selectedHunkIds: Set<string>, hunkIds: string[]): string {
  const hasOmittedHunks = hunkIds.some((id) => !selectedHunkIds.has(id));
  if (hasOmittedHunks) {
    return `Deterministic fallback group for changes omitted from AI context in ${path}`;
  }

  return `Deterministic fallback group for changes left unassigned by AI in ${path}`;
}

function normalizeAssignedAnalysisGroups(
  apiGroups: ModelAnalysisGroup[],
  selectedHunkIds: Set<string>,
): {
  groups: NormalizedHunkGroup[];
  assignedHunkIds: string[];
} {
  const assigned = new Set<string>();

  const groups = apiGroups
    .sort((a, b) => a.order - b.order)
    .map((group) => {
      const validHunkIds = group.hunkIds.filter(
        (id) => selectedHunkIds.has(id) && !assigned.has(id),
      );

      for (const id of validHunkIds) {
        assigned.add(id);
      }

      return {
        ...group,
        hunkIds: validHunkIds,
      };
    })
    .filter((group) => group.hunkIds.length > 0);

  let orderCursor =
    normalizedGroups.length > 0
      ? Math.max(...normalizedGroups.map((group) => group.order)) + 1
      : 1;

  const fallbackGroups = new Map<
    string,
    { hunkIds: string[]; category: AnalysisGroup["category"] }
  >();

  for (const hunk of unassignedHunks) {
    const existing = fallbackGroups.get(hunk.path);
    if (existing) {
      existing.hunkIds.push(hunk.id);
      continue;
    }

    fallbackGroups.set(hunk.path, {
      hunkIds: [hunk.id],
      category: inferCategoryFromPath(hunk.path),
    });
  }

  for (const [path, fallback] of fallbackGroups) {
    normalizedGroups.push({
      name: buildFallbackGroupName(path),
      description: buildFallbackGroupDescription(path, selectedHunkIds, fallback.hunkIds),
      category: fallback.category,
      order: orderCursor++,
      hunkIds: fallback.hunkIds,
    });
  }

  return {
    groups: normalizedGroups,
    fallbackGroupCount: fallbackGroups.size,
    fallbackHunkCount: Array.from(fallbackGroups.values()).reduce(
      (total, group) => total + group.hunkIds.length,
      0,
    ),
  };
}

function buildAnalysisGroupsFromHunkGroups(
  groups: NormalizedHunkGroup[],
  allHunks: HunkDescriptor[],
): AnalysisGroup[] {
  const hunkById = new Map(allHunks.map((hunk) => [hunk.id, hunk]));

  return groups.map((group) => {
    const fileHunksMap = new Map<
      string,
      { lineRanges: Array<{ start: number; end: number }>; hunkIndices: number[] }
    >();

    for (const hunkId of group.hunkIds) {
      const hunk = hunkById.get(hunkId);
      if (!hunk) continue;

      const existing = fileHunksMap.get(hunk.path) ?? {
        lineRanges: [],
        hunkIndices: [],
      };

      existing.lineRanges.push({
        start: hunk.newStart,
        end: Math.max(hunk.newStart + 1, hunk.newEnd),
      });
      existing.hunkIndices.push(hunk.hunkIndex);
      fileHunksMap.set(hunk.path, existing);
    }

    return {
      name: group.name,
      description: group.description,
      files: Array.from(fileHunksMap.keys()),
      fileHunks: Array.from(fileHunksMap.entries()).map(([path, fileHunks]) => ({
        path,
        lineRanges: fileHunks.lineRanges,
        hunkIndices: fileHunks.hunkIndices,
      })),
      category: group.category,
      order: group.order,
    };
  });
}

function splitAnalysisGroupsByFileLimit(
  groups: AnalysisGroup[],
  maxFilesPerGroup: number = MAX_ANALYZABLE_FILES_PER_GROUP,
): AnalysisGroup[] {
  if (maxFilesPerGroup < 1) {
    return groups;
  }

  const splitGroups: AnalysisGroup[] = [];
  let orderCursor = 1;

  for (const group of [...groups].sort((a, b) => a.order - b.order)) {
    if (group.fileHunks.length <= maxFilesPerGroup) {
      splitGroups.push({
        ...group,
        files: [...group.files],
        fileHunks: group.fileHunks.map((fileHunk) => ({
          path: fileHunk.path,
          lineRanges: [...fileHunk.lineRanges],
          hunkIndices: [...fileHunk.hunkIndices],
        })),
        order: orderCursor++,
      });
      continue;
    }

    for (let chunkStart = 0; chunkStart < group.fileHunks.length; chunkStart += maxFilesPerGroup) {
      const fileChunk = group.fileHunks.slice(chunkStart, chunkStart + maxFilesPerGroup);
      const chunkIndex = Math.floor(chunkStart / maxFilesPerGroup);
      splitGroups.push({
        ...group,
        name: `${group.name} (part ${chunkIndex + 1})`,
        description: `${group.description} Split automatically to keep commit groups at ${maxFilesPerGroup} analyzable files max.`,
        files: fileChunk.map((fileHunk) => fileHunk.path),
        fileHunks: fileChunk.map((fileHunk) => ({
          path: fileHunk.path,
          lineRanges: [...fileHunk.lineRanges],
          hunkIndices: [...fileHunk.hunkIndices],
        })),
        order: orderCursor++,
      });
    }
  }

  return splitGroups;
}

function buildFallbackAssetCommitMessage(path: string): string {
  return `chore: include asset ${path}`;
}

function getPathTokens(path: string): Set<string> {
  return new Set(
    path
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 2),
  );
}

function getAssetLookupTerms(path: string): string[] {
  const normalized = path.toLowerCase();
  const segments = normalized.split("/").filter(Boolean);
  const basename = segments[segments.length - 1] ?? normalized;
  const basenameWithoutExtension = basename.replace(/\.[^.]+$/, "");
  return Array.from(
    new Set(
      [normalized, basename, basenameWithoutExtension]
        .map((value) => value.trim())
        .filter((value) => value.length >= 2),
    ),
  );
}

function scoreAssetMatch(assetPath: string, group: AnalysisGroup): number {
  const assetTerms = getAssetLookupTerms(assetPath);
  const assetTokens = getPathTokens(assetPath);
  let score = 0;
  const referenceFiles =
    group.fileHunks.length > 0 ? group.fileHunks.map((fileHunk) => fileHunk.path) : group.files;

  for (const file of referenceFiles) {
    const normalizedFile = file.toLowerCase();
    for (const term of assetTerms) {
      if (term.includes("/") && normalizedFile.includes(term)) {
        score += 10;
      } else if (term.length >= 3 && normalizedFile.includes(term)) {
        score += 8;
      }
    }

    const fileTokens = getPathTokens(file);
    let sharedTokens = 0;
    for (const token of assetTokens) {
      if (fileTokens.has(token)) {
        sharedTokens++;
      }
    }
    score += sharedTokens;
  }

  const description = `${group.name} ${group.description}`.toLowerCase();
  for (const term of assetTerms) {
    if (term.length >= 3 && description.includes(term)) {
      score += term.includes("/") ? 6 : 4;
    }
  }

  return score;
}

function attachAssetsToGroups(
  groups: AnalysisGroup[],
  assetFiles: FileChange[],
): { groups: AnalysisGroup[]; summary: AssetAssignmentSummary } {
  if (assetFiles.length === 0) {
    return {
      groups,
      summary: { attachedAssetCount: 0, fallbackAssetCount: 0 },
    };
  }

  const normalizedGroups = groups
    .map((group) => ({
      ...group,
      files: [...group.files],
      fileHunks: [...group.fileHunks],
    }))
    .sort((a, b) => a.order - b.order);

  const fallbackGroups: AnalysisGroup[] = [];
  let attachedAssetCount = 0;

  for (const asset of [...assetFiles].sort((a, b) => a.path.localeCompare(b.path))) {
    let bestGroup: AnalysisGroup | null = null;
    let bestScore = 0;

    for (const group of normalizedGroups) {
      const score = scoreAssetMatch(asset.path, group);
      if (score > bestScore) {
        bestScore = score;
        bestGroup = group;
      }
    }

    if (bestGroup && bestScore > 0) {
      if (!bestGroup.files.includes(asset.path)) {
        bestGroup.files.push(asset.path);
      }
      attachedAssetCount++;
      continue;
    }

    fallbackGroups.push({
      name: `include asset ${asset.path}`,
      description: `Deterministic fallback commit for non-analyzable asset ${asset.path}`,
      files: [asset.path],
      fileHunks: [],
      category: "chore",
      order: 0,
      commitMessage: buildFallbackAssetCommitMessage(asset.path),
    });
  }

  let orderCursor =
    normalizedGroups.length > 0 ? Math.max(...normalizedGroups.map((group) => group.order)) + 1 : 1;
  for (const fallbackGroup of fallbackGroups) {
    fallbackGroup.order = orderCursor++;
    normalizedGroups.push(fallbackGroup);
  }

  return {
    groups: normalizedGroups,
    summary: {
      attachedAssetCount,
      fallbackAssetCount: fallbackGroups.length,
    },
  };
}

function prepareAnalysisInput(
  files: FileChange[],
  diffs: Map<string, string>,
  untrackedContent: Map<string, string>,
  untrackedBytes?: Map<string, Uint8Array>,
): {
  analyzableFiles: FileChange[];
  assetFiles: FileChange[];
  classifications: ReturnType<typeof classifyFiles>;
  hunks: HunkDescriptor[];
} {
  const classifications = classifyFiles({ files, diffs, untrackedContent, untrackedBytes });
  const analyzableFiles = files.filter(
    (file) => classifications.get(file.path)?.kind === "analyzable",
  );
  const assetFiles = files.filter((file) => classifications.get(file.path)?.kind === "asset");

  return {
    analyzableFiles,
    assetFiles,
    classifications,
    hunks: buildHunkDescriptors(analyzableFiles, diffs, untrackedContent),
  };
}

function truncateText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function buildAdaptiveReductionSequence(initialCount: number, minCount: number): number[] {
  if (initialCount <= 0) {
    return [];
  }

  const counts: number[] = [];
  let current = initialCount;

  while (current > minCount) {
    counts.push(current);

    const reduced = Math.max(
      minCount,
      Math.floor(current * (current > 80 ? 0.65 : current > 30 ? 0.75 : 0.8)),
    );
    current = reduced < current ? reduced : current - 1;
  }

  counts.push(minCount);
  return Array.from(new Set(counts.filter((count) => count > 0)));
}

function isOversizedRequestError(error: unknown): boolean {
  const lower = (error instanceof Error ? error.message : String(error)).toLowerCase();

  return (
    lower.includes("request too large") ||
    lower.includes("reduce message size") ||
    lower.includes("reduce the length of the messages") ||
    lower.includes("prompt too long") ||
    lower.includes("prompt is too long") ||
    lower.includes("input too long") ||
    lower.includes("input is too long") ||
    lower.includes("context_length_exceeded") ||
    lower.includes("context length exceeded") ||
    lower.includes("maximum context length") ||
    lower.includes("too many prompt tokens") ||
    lower.includes("too many input tokens") ||
    (lower.includes("please reduce") && (lower.includes("prompt") || lower.includes("message"))) ||
    ((lower.includes("tokens per minute") || lower.includes(" tpm")) &&
      lower.includes("requested") &&
      lower.includes("limit"))
  );
}

function isTransientModelError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();

  return (
    !isOversizedRequestError(error) &&
    (message.includes("rate limit") ||
      message.includes("timeout") ||
      message.includes("network") ||
      message.includes("503") ||
      message.includes("529") ||
      message.includes("overloaded"))
  );
}

function buildAnalysisBasePrompt({
  context,
  analyzableFileCount,
  assetFiles,
  totalHunks,
  selectedHunks,
}: {
  context: string;
  analyzableFileCount: number;
  assetFiles: FileChange[];
  totalHunks: number;
  selectedHunks: HunkDescriptor[];
}): string {
  const omittedHunks = totalHunks - selectedHunks.length;
  const selectedFiles = new Set(selectedHunks.map((hunk) => hunk.path)).size;
  const excludedAssetsNote =
    assetFiles.length > 0
      ? `\nExcluded non-analyzable assets from AI grouping: ${assetFiles.map((file) => file.path).join(", ")}.`
      : "";

  const coverageNote =
    omittedHunks > 0
      ? `\nContext budget applied: ${selectedHunks.length}/${totalHunks} hunks included across ${selectedFiles}/${analyzableFileCount} analyzable files.`
      : "";

  return `You are an expert developer analyzing code changes to create atomic, well-structured git commits.
${coverageNote}${excludedAssetsNote}
## Task
Analyze the following hunk-level changes and determine how to split them into ATOMIC commits.
Return hunk IDs only. Do not invent IDs.

## CRITICAL: Hunk ID Requirements
- Use ONLY provided hunk IDs
- Every included hunk ID should appear in exactly one commit group
- Prefer preserving atomicity over minimizing number of commits
- If a file has unrelated hunks, split them into different commits
- Never place more than 2 analyzable files in a single commit group

## Atomic Commit Guidelines
- Each commit should contain ONLY related changes
- Split aggressively: prefer more commits over fewer
- Group related hunks together, even if from different files
- Consider dependencies: types before implementations

## Categories
- setup: Initial setup, configs, dependencies
- feature: New features and functionality
- fix: Bug fixes
- refactor: Code restructuring without behavior change
- docs: Documentation only
- test: Test files
- chore: Maintenance, tooling, build changes
- style: Formatting, linting, cosmetic changes

## Input Changes
${context}

Analyzable files: ${analyzableFileCount}
Excluded assets: ${assetFiles.length}
Total analyzable hunks: ${totalHunks}
Included hunks: ${selectedHunks.length}

Provide commit groups with hunk IDs only.`;
}

function buildCommitMessagesBasePrompt(
  commits: Array<{
    files: FileChange[];
    category: string;
    name: string;
    description: string;
  }>,
  existingMessages: string[],
  detail: CommitMessagePromptDetail,
): string {
  const detailConfig = COMMIT_MESSAGE_DETAIL_CONFIG[detail];
  const styleHint =
    existingMessages.length > 0
      ? `\nExisting commit message style in this repo:\n${existingMessages
          .slice(0, detailConfig.maxStyleExamples)
          .map((message) => truncateText(message, 72))
          .join("\n")}`
      : "";

  const commitLines = commits
    .map((commit, index) => {
      const parts = [
        `${index}. Category: ${commit.category}`,
        `Name: ${truncateText(commit.name, 80)}`,
        `Description: ${truncateText(commit.description, detailConfig.maxDescriptionChars)}`,
      ];

      if (detailConfig.includeFiles) {
        const filePaths = commit.files.map((file) => file.path);
        const visibleFiles = filePaths.slice(0, detailConfig.maxFiles);
        const remainingFileCount = filePaths.length - visibleFiles.length;
        const fileSummary =
          remainingFileCount > 0
            ? `${visibleFiles.join(", ")}, +${remainingFileCount} more`
            : visibleFiles.join(", ");
        parts.push(`Files: ${fileSummary}`);
      }

      return parts.join("\n   ");
    })
    .join("\n\n");

  const compactHint =
    detail === "full"
      ? ""
      : "\nUse the reduced commit summaries provided here; do not ask for more detail.";

  return `Generate commit messages for the following commits. Use conventional commit format (type: description).

IMPORTANT: These commits should already be ATOMIC - each represents a single, self-contained change. Generate messages that reflect this atomic nature.
${styleHint}${compactHint}

Commits to generate messages for:
${commitLines}

Generate concise but descriptive commit messages. Focus on \"why\" not \"what\". Each message should clearly convey the purpose of this atomic change.`;
}

async function requestCachedStructuredObject<T>({
  model,
  schema,
  prompt,
  cacheKey,
  ttl,
  requestType,
  provider,
  modelId,
}: {
  model: ReturnType<ReturnType<typeof createOpenAI>>;
  schema: z.ZodSchema<T>;
  prompt: string;
  cacheKey: string;
  ttl?: number;
  requestType: "analyze" | "commit_messages" | "date_parse";
  provider: string;
  modelId: string;
}): Promise<{ object: T }> {
  return withRetry(
    () =>
      generateObjectWithCache({
        model,
        schema,
        prompt,
        cacheKey,
        ttl,
        requestType,
        provider,
        modelId,
      }),
    {
      maxRetries: 3,
      initialDelayMs: 1000,
      shouldRetry: isTransientModelError,
    },
  );
}

/**
 * Append custom prompt to the base prompt if configured
 */
async function buildPrompt(basePrompt: string): Promise<string> {
  const customPrompt = await getCustomPrompt();
  if (customPrompt) {
    return `${basePrompt}\n\n--- Additional Instructions ---\n${customPrompt}`;
  }
  return basePrompt;
}

/**
 * Retry configuration
 */
const RETRY_CONFIG = {
  maxRetries: 5,
  initialDelayMs: 2000,
  maxDelayMs: 30000,
};

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if an error is retryable
 */
function isRetryableError(error: unknown): boolean {
  const errorStr = String(error);
  return (
    // JSON/parsing errors (common with free/small models)
    errorStr.includes("JSON") ||
    errorStr.includes("parse") ||
    errorStr.includes("NoObjectGeneratedError") ||
    errorStr.includes("Unterminated") ||
    errorStr.includes("truncated") ||
    // Network/server errors
    errorStr.includes("fetch") ||
    errorStr.includes("network") ||
    errorStr.includes("ECONNRESET") ||
    errorStr.includes("ETIMEDOUT") ||
    // Rate limits and capacity errors
    errorStr.includes("429") ||
    errorStr.includes("rate limit") ||
    errorStr.includes("503") ||
    errorStr.includes("capacity") ||
    errorStr.includes("Server at capacity") ||
    errorStr.includes("RetryError") ||
    errorStr.includes("isRetryable")
  );
}

/**
 * Format error message for user display
 */
export function formatAIError(error: unknown): string {
  const errorStr = String(error);

  if (isOversizedRequestError(error)) {
    return "The AI request is still too large for the current model after Chronicle reduced the context as much as it could. Try again with a model that supports larger prompts or higher TPM with 'chronicle config model'.";
  }

  if (
    errorStr.includes("data policy") ||
    errorStr.includes("Free model publication") ||
    errorStr.includes("No endpoints found matching")
  ) {
    return "The free model is not available with your current OpenRouter privacy settings.\n\nOptions:\n  1. Configure privacy settings at https://openrouter.ai/settings/privacy\n  2. Run 'chronicle config model' to switch to a different model\n  3. Add your own API key at https://openrouter.ai/settings/integrations";
  }

  if (errorStr.includes("429") || errorStr.includes("rate limit") || errorStr.includes("rate-limited")) {
    if (errorStr.includes("free") || errorStr.includes("upstream")) {
      return "The free model is temporarily rate-limited.\n\nOptions:\n  1. Wait a few minutes and retry\n  2. Run 'chronicle config model' to switch to a different model\n  3. Add your own API key at https://openrouter.ai/settings/integrations";
    }
    return "Rate limit exceeded. Please wait a moment and try again, or run 'chronicle config model' to switch models.";
  }

  if (errorStr.includes("abort") || errorStr.includes("timeout") || errorStr.includes("Timeout")) {
    return "The AI request timed out. Try using a faster model with 'chronicle config model'.";
  }

  if (errorStr.includes("503") || errorStr.includes("capacity")) {
    return "The AI model is currently at capacity. Try again in a few minutes or run 'chronicle config model' to switch models.";
  }

  if (errorStr.includes("401") || errorStr.includes("unauthorized") || errorStr.includes("Unauthorized")) {
    return "Invalid API key. Please run 'chronicle config init' to reconfigure.";
  }

  if (errorStr.includes("NoObjectGeneratedError") || errorStr.includes("JSON")) {
    return "The AI model returned an invalid response. This often happens with free models. Consider switching to a more capable model with 'chronicle config model'.";
  }

  if (errorStr.includes("fetch") || errorStr.includes("network")) {
    return "Network error. Please check your internet connection.";
  }

  return `AI error: ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Execute a function with exponential backoff retry
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    shouldRetry?: (error: unknown) => boolean;
  } = {},
): Promise<T> {
  const {
    maxRetries = RETRY_CONFIG.maxRetries,
    initialDelayMs = RETRY_CONFIG.initialDelayMs,
    maxDelayMs = RETRY_CONFIG.maxDelayMs,
    shouldRetry = isRetryableError,
  } = options;

  let lastError: unknown;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxRetries || !shouldRetry(error)) {
        throw error;
      }
      
      // Exponential backoff with jitter
      const delay = Math.min(
        initialDelayMs * Math.pow(2, attempt) + Math.random() * 1000,
        maxDelayMs,
      );
      
      await sleep(delay);
    }
  }
  
  throw lastError;
}

/**
 * Wrapper for generateObject with file-based caching and retry logic
 * This provides persistent caching across CLI runs
 */
async function generateObjectWithCache<T>({
  model,
  schema,
  prompt,
  cacheKey,
  ttl,
  requestType,
  provider,
  modelId,
}: {
  model: ReturnType<ReturnType<typeof createOpenAI>>;
  schema: z.ZodSchema<T>;
  prompt: string;
  cacheKey: string;
  ttl?: number;
  requestType: "analyze" | "commit_messages" | "date_parse";
  provider: string;
  modelId: string;
}): Promise<{ object: T }> {
  // Try to get from cache first
  const cached = await getCache<{ object: T }>(cacheKey, {
    namespace: CacheNamespaces.AI_RESPONSES,
    ttl,
  });

  if (cached) {
    telemetry.track({
      event: "ai_request_made",
      properties: {
        provider,
        model_category: categorizeModel(modelId),
        request_type: requestType,
        latency_ms: 0,
        cache_hit: true,
        success: true,
      },
    });
    return cached;
  }

  const timer = createTimer();
  let success = true;
  let errorType: string | undefined;

  const TIMEOUT_MS = 600000; // 10 minutes - some models are slow

  try {
    const result = await withRetry(
      async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

        try {
          return await generateObjectWithSchemaFallback({
            model,
            schema,
            prompt,
            abortSignal: controller.signal,
          });
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            throw new Error("Request timed out after 5 minutes. Try using a faster model or reduce file sizes.");
          }
          throw error;
        } finally {
          clearTimeout(timeoutId);
        }
      },
      {
        shouldRetry: (error: unknown) => {
          const errorStr = String(error);
          return (
            errorStr.includes("JSON") ||
            errorStr.includes("parse") ||
            errorStr.includes("NoObjectGeneratedError") ||
            errorStr.includes("Unterminated") ||
            errorStr.includes("truncated")
          );
        },
      },
    );

    // Cache the result
    await setCache(cacheKey, result, {
      namespace: CacheNamespaces.AI_RESPONSES,
      ttl,
    });

    return result;
  } catch (error) {
    success = false;
    errorType = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    telemetry.track({
      event: "ai_request_made",
      properties: {
        provider,
        model_category: categorizeModel(modelId),
        request_type: requestType,
        latency_ms: timer(),
        cache_hit: false,
        success,
        error_type: errorType,
      },
    });
  }
}

function isStructuredOutputUnsupportedError(error: unknown): boolean {
  const errorStr = error instanceof Error ? error.message : String(error);
  const lower = errorStr.toLowerCase();

  return (
    lower.includes("does not support response format `json_schema`") ||
    lower.includes("does not support response format json_schema") ||
    lower.includes("response format `json_schema`")
  );
}

function buildSchemaFallbackPrompt<T>(prompt: string, schema: z.ZodSchema<T>): string {
  const jsonSchema = JSON.stringify(z.toJSONSchema(schema), null, 2);

  return `${prompt}

Return only a JSON object that matches this JSON Schema exactly.
Do not include markdown fences, explanations, or any extra text.

JSON Schema:
${jsonSchema}`;
}

async function generateObjectWithSchemaFallback<T>({
  model,
  schema,
  prompt,
  abortSignal,
}: {
  model: ReturnType<ReturnType<typeof createOpenAI>>;
  schema: z.ZodSchema<T>;
  prompt: string;
  abortSignal: AbortSignal;
}): Promise<{ object: T }> {
  try {
    return await generateObject({
      model,
      schema,
      prompt,
      abortSignal,
    });
  } catch (error) {
    if (!isStructuredOutputUnsupportedError(error)) {
      throw error;
    }

    const fallback = await generateObject({
      model,
      output: "no-schema",
      prompt: buildSchemaFallbackPrompt(prompt, schema),
      abortSignal,
    });

    return {
      object: schema.parse(fallback.object),
    };
  }
}

export const __internal = {
  isStructuredOutputUnsupportedError,
  buildSchemaFallbackPrompt,
  buildAdaptiveReductionSequence,
  buildCommitMessagesBasePrompt,
  isOversizedRequestError,
  normalizeAnalysisGroups,
  buildAnalysisGroupsFromHunkGroups,
  splitAnalysisGroupsByFileLimit,
  attachAssetsToGroups,
  buildFallbackAssetCommitMessage,
  prepareAnalysisInput,
};

// Re-export for backward compatibility
export { PROVIDER_CONFIG, type ProviderKey } from "./models";

/**
 * Get the AI model based on config (with Result type)
 */
async function getModelSafe(): Promise<
  Result<ReturnType<ReturnType<typeof createOpenAI>>, NoApiKeyError>
> {
  const config = await loadConfig();
  const provider = getSelectedProvider(config) as ProviderKey;
  const apiKey = await getApiKey(provider);
  const selectedModel = getSelectedModel(config);
  const selectedProviderConfig = getSelectedProviderConfig(config);
  const providerConfig = PROVIDER_CONFIG[provider];

  if (!providerConfig) {
    return Result.err(new NoApiKeyError({ provider }));
  }

  // Ollama and Cloudflare don't use the standard API key pattern
  if (provider !== "ollama" && provider !== "cloudflare" && !apiKey) {
    return Result.err(
      new NoApiKeyError({
        provider: providerConfig.name,
      }),
    );
  }

  switch (provider) {
    case "openai": {
      const openai = createOpenAI({ apiKey });
      return Result.ok(openai(selectedModel ?? providerConfig.defaultModel));
    }
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey });
      return Result.ok(
        anthropic(selectedModel ?? providerConfig.defaultModel) as ReturnType<
          ReturnType<typeof createOpenAI>
        >,
      );
    }
    case "gemini": {
      const google = createGoogleGenerativeAI({ apiKey });
      return Result.ok(
        google(selectedModel ?? providerConfig.defaultModel) as ReturnType<
          ReturnType<typeof createOpenAI>
        >,
      );
    }
    case "openrouter": {
      const openrouter = createOpenAI({
        apiKey,
        baseURL: "https://openrouter.ai/api/v1",
      });
      return Result.ok(openrouter(selectedModel ?? providerConfig.defaultModel));
    }
    case "groq": {
      const groq = createOpenAI({
        apiKey,
        baseURL: "https://api.groq.com/openai/v1",
      });
      return Result.ok(groq(selectedModel ?? providerConfig.defaultModel));
    }
    case "ollama": {
      const ollama = createOpenAI({
        baseURL: selectedProviderConfig?.baseUrl ?? "http://localhost:11434/v1",
        apiKey: "ollama",
      });
      return Result.ok(ollama(selectedModel ?? providerConfig.defaultModel));
    }
    case "cloudflare": {
      const { accountId, gatewayId, apiToken } = await getCloudflareConfig();

      if (!accountId || !gatewayId || !apiToken) {
        return Result.err(new NoApiKeyError({ provider: "Cloudflare AI Gateway" }));
      }

      const cloudflare = createOpenAI({
        apiKey: apiToken,
        baseURL: `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/compat`,
        headers: {
          "cf-aig-authorization": `Bearer ${apiToken}`,
        },
      });
      return Result.ok(cloudflare(selectedModel ?? providerConfig.defaultModel));
    }
    case "opencode-zen": {
      const opencodeZen = createOpenAICompatible({
        name: "opencode-zen",
        apiKey,
        baseURL: "https://opencode.ai/zen/v1",
      });
      return Result.ok(opencodeZen(selectedModel ?? providerConfig.defaultModel));
    }
    default:
      return Result.err(new NoApiKeyError({ provider }));
  }
}

/**
 * Legacy getModel for backward compatibility
 */
async function getModel() {
  const result = await getModelSafe();
  if (!Result.isOk(result)) {
    throw new Error(result.error.message);
  }
  return result.value;
}

/**
 * Analyze changes and suggest how to split them into atomic commits
 */
export async function analyzeChanges(
  files: FileChange[],
  diffs: Map<string, string>,
  untrackedContent: Map<string, string>,
  untrackedBytes?: Map<string, Uint8Array>,
): Promise<{
  suggestedCommits: number;
  suggestedDays: number;
  reasoning: string;
  groups: Array<{
    name: string;
    description: string;
    files: string[];
    category: string;
    order: number;
  }>;
}> {
  const model = await getModel();
  const classifications = classifyFiles({ files, diffs, untrackedContent, untrackedBytes });
  const analyzableFiles = files.filter(
    (file) => classifications.get(file.path)?.kind === "analyzable",
  );
  const assetFiles = files.filter((file) => classifications.get(file.path)?.kind === "asset");

  // Build file summary for the prompt
  const fileSummary = analyzableFiles
    .map((f) => {
      const diff = diffs.get(f.path) ?? untrackedContent.get(f.path) ?? "";
      const truncatedDiff = diff.length > 2000 ? diff.slice(0, 2000) + "\n... (truncated)" : diff;
      return `### ${f.path} (${f.status})\n\`\`\`\n${truncatedDiff}\n\`\`\``;
    })
    .join("\n\n");

  const assetNote =
    assetFiles.length > 0
      ? `\nNon-analyzable assets excluded from AI context: ${assetFiles.map((file) => file.path).join(", ")}`
      : "";

  const basePrompt = `You are an expert developer analyzing code changes to create a realistic git commit history.

Analyze the following file changes and determine how to split them into ATOMIC, logical commits that follow best practices:

## CRITICAL: Atomic Commit Guidelines
- SPLIT aggressively: Each commit should contain ONLY related changes that can be understood and reviewed in isolation
- NEVER combine unrelated changes: A bugfix and a feature, or two unrelated features, should be SEPARATE commits
- One concern per commit: If files serve different purposes (e.g., styles, types, implementation), split them
- File-level atomicity: Split files that have unrelated changes within them
- Minimum viable commits: When in doubt, prefer MORE commits over fewer
- Test changes: Group test files with the code they test
- Hard limit: Never place more than 2 analyzable files in a single commit group

## Ordering Requirements
1. Dependencies first: Types/interfaces before implementations, configs before code that uses them
2. No forward dependencies: Earlier commits must not depend on later commits
3. Self-contained: Each commit should work on its own if applied

## Conventional Categories
- setup: Initial setup, configs, dependencies
- feature: New features and functionality
- fix: Bug fixes
- refactor: Code restructuring without behavior change
- docs: Documentation only
- test: Test files
- chore: Maintenance, tooling, build changes
- style: Formatting, linting, cosmetic changes

Files and their changes:
${fileSummary}
${assetNote}

Analyzable files: ${analyzableFiles.length}
Excluded assets: ${assetFiles.length}

Provide your analysis with recommended commit groups. Be AGGRESSIVE in splitting - aim for 1-2 files per commit when possible, never combine unrelated changes.`;

  const prompt = await buildPrompt(basePrompt);

  const analysisSchema = z.object({
    suggestedCommits: z.number().describe("Recommended number of atomic commits"),
    suggestedDays: z
      .number()
      .describe("Recommended number of days to spread commits over for realistic history"),
    reasoning: z.string().describe("Brief explanation of the analysis and recommendations"),
    groups: z.array(
      z.object({
        name: z.string().describe("Short name for this commit group (for the commit message)"),
        description: z.string().describe("What this group of changes accomplishes"),
        files: z.array(z.string()).describe("File paths belonging to this group"),
        category: z
          .enum(["setup", "feature", "fix", "refactor", "docs", "test", "chore", "style"])
          .describe("Type of change"),
        order: z
          .number()
          .describe("Execution order (lower = earlier). Consider dependencies between files."),
      }),
    ),
  });

  const { object } = await generateObjectWithSchemaFallback({
    model,
    schema: analysisSchema,
    prompt,
    abortSignal: AbortSignal.timeout(600000),
  });

  return object;
}

/**
 * Analyze changes with Result type for error handling
 */
export async function analyzeChangesSafe(
  files: FileChange[],
  diffs: Map<string, string>,
  untrackedContent: Map<string, string>,
  untrackedBytes?: Map<string, Uint8Array>,
): Promise<
  Result<
    {
      suggestedCommits: number;
      suggestedDays: number;
      reasoning: string;
      groups: Array<AnalysisGroup>;
    },
    NoApiKeyError | AIApiError
  >
> {
  const { analyzableFiles, assetFiles, hunks: allHunks } = prepareAnalysisInput(
    files,
    diffs,
    untrackedContent,
    untrackedBytes,
  );
  if (allHunks.length === 0) {
    const assetAssignment = attachAssetsToGroups([], assetFiles);
    return Result.ok({
      suggestedCommits: assetAssignment.groups.length,
      suggestedDays: Math.max(1, assetAssignment.groups.length),
      reasoning:
        assetFiles.length > 0
          ? `No analyzable text/code hunks were found. Chronicle created deterministic asset commit groups for ${assetFiles.length} non-analyzable file${assetFiles.length === 1 ? "" : "s"}.`
          : "No diff hunks available to analyze.",
      groups: assetAssignment.groups,
    });
  }

  const byPriority = [...allHunks].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (b.added + b.removed !== a.added + a.removed) {
      return b.added + b.removed - (a.added + a.removed);
    }
    return a.id.localeCompare(b.id);
  });
  const modelResult = await getModelSafe();
  if (!Result.isOk(modelResult)) {
    return modelResult;
  }

  const model = modelResult.value;
  const config = await loadConfig();
  const provider = getSelectedProvider(config);
  const modelId = getSelectedModel(config) ?? "";
  try {
    const passResult = await analyzeHunksInBoundedPasses({
      model,
      analyzableFiles,
      assetFiles,
      allHunks: byPriority,
      provider,
      modelId,
    });

    const assignedIds = new Set(passResult.assignedHunkIds);
    const normalized = appendDeterministicFallbackGroups(
      passResult.groups,
      byPriority.filter((hunk) => !assignedIds.has(hunk.id)),
      new Set(passResult.assignedHunkIds),
    );

    const groups = splitAnalysisGroupsByFileLimit(
      buildAnalysisGroupsFromHunkGroups(normalized.groups, byPriority),
    );
    const assetAssignment = attachAssetsToGroups(groups, assetFiles);

    const reasoningParts = [...passResult.reasoning];
    if (normalized.fallbackGroupCount > 0) {
      reasoningParts.push(
        `Chronicle added ${normalized.fallbackGroupCount} deterministic fallback group${normalized.fallbackGroupCount === 1 ? "" : "s"} to include ${normalized.fallbackHunkCount} remaining hunk${normalized.fallbackHunkCount === 1 ? "" : "s"}.`,
      );
    }
    if (passResult.attempts > 1) {
      reasoningParts.push(
        `Chronicle used ${passResult.attempts} bounded analysis pass${passResult.attempts === 1 ? "" : "es"} to assign remaining hunks before falling back deterministically.`,
      );
    }
    if (passResult.contextLimited) {
      reasoningParts.push(
        "Chronicle had to reduce AI context in at least one pass, then continued analyzing the remaining hunks in later passes.",
      );
    }
    if (assetFiles.length > 0) {
      reasoningParts.push(
        `Chronicle excluded ${assetFiles.length} non-analyzable asset file${assetFiles.length === 1 ? "" : "s"} from AI context, attached ${assetAssignment.summary.attachedAssetCount} to related commit group${assetAssignment.summary.attachedAssetCount === 1 ? "" : "s"}, and created ${assetAssignment.summary.fallbackAssetCount} deterministic asset fallback commit${assetAssignment.summary.fallbackAssetCount === 1 ? "" : "s"}.`,
      );
    }

    return Result.ok({
      suggestedCommits: assetAssignment.groups.length,
      suggestedDays: Math.max(1, ...passResult.suggestedDays),
      reasoning: reasoningParts.join("\n\n"),
      groups: assetAssignment.groups,
    });
  } catch (error) {
    return Result.err(
      new AIApiError({
        provider,
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      }),
    );
  }
}

/**
 * Generate commit messages for planned commits
 */
export function normalizeCommitMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return trimmed;

  const [subject = "", ...rest] = trimmed.split("\n");
  const normalizedSubject = subject.endsWith(".") ? subject.slice(0, -1) : subject;

  return [normalizedSubject, ...rest].join("\n");
}

export async function generateCommitMessages(
  commits: Array<{
    files: FileChange[];
    category: string;
    name: string;
    description: string;
  }>,
  existingMessages: string[] = [],
): Promise<string[]> {
  const model = await getModel();
  const config = await loadConfig();
  const provider = getSelectedProvider(config);
  const modelId = getSelectedModel(config) ?? "";
  const schema = z.object({
    messages: z.array(
      z.object({
        message: z.string().describe("Commit message following conventional commits format"),
        index: z.number().describe("Index of the commit this message is for"),
      }),
    ),
  });

  for (const detail of ["full", "compact", "minimal", "tiny"] as const) {
    const promptText = await buildPrompt(buildCommitMessagesBasePrompt(commits, existingMessages, detail));

    if (promptText.length > COMMIT_MESSAGES_CHAR_BUDGET && detail !== "tiny") {
      continue;
    }

    try {
      const result = await requestCachedStructuredObject({
        model,
        schema,
        prompt: promptText,
        cacheKey: generateCacheKey({ prompt: promptText, commitCount: commits.length }),
        ttl: 24 * 60 * 60 * 1000,
        requestType: "commit_messages",
        provider,
        modelId,
      });

      return result.object.messages
        .sort((a, b) => a.index - b.index)
        .map((message) => normalizeCommitMessage(message.message));
    } catch (error) {
      if (isOversizedRequestError(error) && detail !== "tiny") {
        continue;
      }

      throw error;
    }
  }

  throw new Error(
    "Request too large for the current model after Chronicle reduced the commit-message context as much as it could.",
  );
}

/**
 * Parse natural language date range
 */
export async function parseDateRange(input: string): Promise<{ start: Date; end: Date }> {
  const model = await getModel();
  const config = await loadConfig();
  const now = new Date();

  const inputTrimmed = input.trim();

  const singleDateMatch = inputTrimmed.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (singleDateMatch && singleDateMatch[1] && singleDateMatch[2]) {
    const year = parseInt(singleDateMatch[1], 10);
    const month = parseInt(singleDateMatch[2], 10) - 1;
    const day = singleDateMatch[3] ? parseInt(singleDateMatch[3], 10) : 1;

    if (month >= 0 && month <= 11 && day >= 1 && day <= 31 && year >= 2000 && year <= 2100) {
      const parsedDate = new Date(year, month, day);
      return { start: parsedDate, end: now };
    }
  }

  const dateRangeMatch = inputTrimmed.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?\s*(?:to|-|through)\s*(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (dateRangeMatch && dateRangeMatch[1] && dateRangeMatch[2] && dateRangeMatch[4] && dateRangeMatch[5]) {
    const startYear = parseInt(dateRangeMatch[1], 10);
    const startMonth = parseInt(dateRangeMatch[2], 10) - 1;
    const startDay = dateRangeMatch[3] ? parseInt(dateRangeMatch[3], 10) : 1;
    const endYear = parseInt(dateRangeMatch[4], 10);
    const endMonth = parseInt(dateRangeMatch[5], 10) - 1;
    const endDay = dateRangeMatch[6] ? parseInt(dateRangeMatch[6], 10) : 28;

    if (startMonth >= 0 && startMonth <= 11 && endMonth >= 0 && endMonth <= 11) {
      const startDate = new Date(startYear, startMonth, startDay);
      const endDate = new Date(endYear, endMonth, endDay);
      return { start: startDate, end: endDate };
    }
  }

  const promptText = `Parse this natural language date range into day offsets from today.
Today is: ${now.toISOString().split("T")[0]}

Input: "${inputTrimmed}"

Examples:
- "last 30 days" -> startOffset: 30, endOffset: 0
- "2026-02-01 to 2026-02-15" -> startOffset: calculated from today, endOffset: 0
- "spread over 2 weeks" -> startOffset: 14, endOffset: 0
- "past week" -> startOffset: 7, endOffset: 0
- "last month" -> startOffset: 30, endOffset: 0

Return the offsets as positive integers.`;

  // Generate cache key
  const cacheKey = generateCacheKey({ prompt: promptText, today: now.toISOString().split("T")[0] });

  const result = await generateObjectWithCache({
    model,
    schema: z.object({
      startOffset: z.number().describe("Days before today for start date (positive number)"),
      endOffset: z.number().describe("Days before today for end date (0 = today)"),
    }),
    prompt: promptText,
    cacheKey,
    ttl: 7 * 24 * 60 * 60 * 1000, // 7 days - date parsing results don't change often
    requestType: "date_parse",
    provider: getSelectedProvider(config),
    modelId: getSelectedModel(config) ?? "",
  });

  const start = new Date(now);
  start.setDate(start.getDate() - result.object.startOffset);

  const end = new Date(now);
  end.setDate(end.getDate() - result.object.endOffset);

  return { start, end };
}
