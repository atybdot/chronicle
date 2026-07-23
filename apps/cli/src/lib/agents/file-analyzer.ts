import { generateText, tool } from "ai";
import { z } from "zod";
import type { FileChange, Hunk, HunkSummary, HunkDetail } from "../../types";
import { computeHunkId, getDiffs, parseDiffs, type FileDiff } from "../git";
import { classifyFiles, type FileClassification } from "../file-classification";
import { loadConfig, resolveModelForAgent } from "../config";

type FileAnalyzerResult = {
  hunks: Hunk[];
  summaries: HunkSummary[];
  classifications: Map<string, FileClassification>;
} | { error: string };

type GetHunksDetailResult = {
  hunks: HunkDetail[];
};

const ASSET_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg",
  ".woff", ".woff2", ".ttf", ".eot",
  ".pdf", ".zip", ".tar", ".gz", ".7z",
]);

const ASSET_DIRECTORIES = ["node_modules/", "dist/", "build/", ".next/", ".cache/"];

function isAssetFile(path: string): boolean {
  const lowerPath = path.toLowerCase();
  
  // Check for asset directories
  for (const dir of ASSET_DIRECTORIES) {
    if (lowerPath.includes(dir)) return true;
  }
  
  // Check for asset extensions
  const lastDot = path.lastIndexOf(".");
  if (lastDot >= 0) {
    const ext = path.slice(lastDot).toLowerCase();
    if (ASSET_EXTENSIONS.has(ext)) return true;
  }
  
  return false;
}

function createHunkFromState(
  state: {
    newStart: number;
    newEnd: number;
    addedLines: number;
    removedLines: number;
    contentLines: string[];
  },
  filePath: string,
  status: FileChange["status"],
  hunkIndex: number,
): Hunk {
  const diffContent = state.contentLines.join("\n");
  return {
    id: computeHunkId(diffContent),
    filePath,
    status,
    hunkIndex,
    newStart: state.newStart,
    newEnd: state.newEnd,
    addedLines: state.addedLines,
    removedLines: state.removedLines,
    changeType: state.addedLines > 0 && state.removedLines > 0 
      ? "mixed" 
      : state.addedLines > 0 
        ? "addition" 
        : "deletion",
  };
}

function extractHunksFromFile(
  filePath: string,
  diff: string,
  status: FileChange["status"]
): Hunk[] {
  const hunks: Hunk[] = [];
  const lines = diff.split("\n");
  let currentHunk: {
    newStart: number;
    newEnd: number;
    addedLines: number;
    removedLines: number;
    contentLines: string[];
  } | null = null;
  let hunkIndex = 0;
  
  for (const line of lines) {
    if (line.startsWith("@@")) {
      // Save previous hunk if exists
      if (currentHunk) {
        hunks.push(createHunkFromState(currentHunk, filePath, status, hunkIndex));
        hunkIndex++;
      }
      
      // Parse new hunk header: @@ -oldStart,oldEnd +newStart,newEnd @@
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (match && match[1]) {
        currentHunk = {
          newStart: parseInt(match[1], 10),
          newEnd: match[2] ? parseInt(match[2], 10) : parseInt(match[1], 10),
          addedLines: 0,
          removedLines: 0,
          contentLines: [line], // Include the @@ header in the content
        };
      }
    } else if (currentHunk) {
      currentHunk.contentLines.push(line);
      if (line.startsWith("+")) {
        currentHunk.addedLines++;
      } else if (line.startsWith("-")) {
        currentHunk.removedLines++;
      }
    }
  }
  
  // Save last hunk
  if (currentHunk) {
    hunks.push(createHunkFromState(currentHunk, filePath, status, hunkIndex));
  }
  
  return hunks;
}

function createHunkSummary(
  hunks: Hunk[],
  filePath: string
): HunkSummary {
  const addedTotal = hunks.reduce((sum, h) => sum + h.addedLines, 0);
  const removedTotal = hunks.reduce((sum, h) => sum + h.removedLines, 0);
  
  // Generate semantic labels based on common patterns
  const labels: string[] = [];
  if (hunks.some(h => h.changeType === "addition" || h.changeType === "mixed")) labels.push("addition");
  if (hunks.some(h => h.changeType === "deletion" || h.changeType === "mixed")) labels.push("deletion");
  if (hunks.some(h => h.changeType === "modification" || h.changeType === "mixed")) labels.push("modification");
  
  return {
    id: `${filePath}-${hunks.length}`,
    filePath,
    hunkCount: hunks.length,
    addedTotal,
    removedTotal,
    semanticLabels: labels,
    preview: `Changes in ${filePath}: +${addedTotal} -${removedTotal} lines across ${hunks.length} hunks`,
  };
}

export function classifyChangedFiles(
  files: FileChange[],
  diffs: Map<string, string>
): Map<string, FileClassification> {
  const untrackedContent = new Map<string, string>();
  const classifications = new Map<string, FileClassification>();
  
  for (const file of files) {
    // Check if it's an asset file by extension/directory
    if (isAssetFile(file.path)) {
      classifications.set(file.path, {
        path: file.path,
        kind: "asset",
        reason: "asset-file",
      });
    } else {
      // Use the existing classification logic
      const classification = classifyFiles({
        files: [file],
        diffs,
        untrackedContent,
      }).get(file.path);
      
      if (classification) {
        classifications.set(file.path, classification);
      }
    }
  }
  
  return classifications;
}

export function extractHunksFromChanges(
  files: FileChange[],
  diffs: Map<string, string>,
  classifications: Map<string, FileClassification>
): { hunks: Hunk[]; summaries: HunkSummary[] } {
  const allHunks: Hunk[] = [];
  const allSummaries: HunkSummary[] = [];
  
  for (const file of files) {
    const classification = classifications.get(file.path);
    if (classification?.kind !== "analyzable") continue;
    
    const diff = diffs.get(file.path);
    if (!diff) continue;
    
    const hunks = extractHunksFromFile(file.path, diff, file.status);
    allHunks.push(...hunks);
    
    if (hunks.length > 0) {
      allSummaries.push(createHunkSummary(hunks, file.path));
    }
  }
  
  return { hunks: allHunks, summaries: allSummaries };
}

export function getHunkDetails(
  hunkIds: string[],
  allHunks: Hunk[],
  diffs: Map<string, string>
): GetHunksDetailResult {
  const details: HunkDetail[] = [];
  
  for (const hunkId of hunkIds) {
    const hunk = allHunks.find(h => h.id === hunkId);
    if (!hunk) continue;
    
    const diff = diffs.get(hunk.filePath);
    if (!diff) continue;
    
    // Extract the actual diff content for this hunk
    const lines = diff.split("\n");
    let inHunk = false;
    let hunkContent: string[] = [];
    let hunkCount = 0;
    
    for (const line of lines) {
      if (line.startsWith("@@")) {
        if (inHunk) {
          break;
        }
        hunkCount++;
        inHunk = hunkCount === hunk.hunkIndex + 1; // hunkIndex is 0-based
      } else if (inHunk) {
        hunkContent.push(line);
      }
    }
    
    details.push({
      hunkId,
      fullContent: hunkContent.join("\n"),
      surroundingContext: "",
    });
  }
  
  return { hunks: details };
}

export async function runFileAnalyzer(cwd?: string): Promise<FileAnalyzerResult> {
  try {
    const config = await loadConfig();
    const { model, provider } = resolveModelForAgent("file-analyzer", config);
    
    // Get git diffs
    const fileDiffs = await getDiffs(undefined, cwd);
    
    // Convert FileDiff[] to FileChange[]
    const files: FileChange[] = fileDiffs.map(fd => ({
      path: fd.filePath,
      status: fd.status as FileChange["status"],
    }));
    
    // Create diffs map
    const diffs = new Map<string, string>();
    for (const fd of fileDiffs) {
      // Combine all hunk content for this file
      const diffContent = fd.hunks.map(h => h.content).join("\n");
      diffs.set(fd.filePath, diffContent);
    }
    
    // Classify files
    const classifications = classifyChangedFiles(files, diffs);
    
    // Extract hunks
    const { hunks, summaries } = extractHunksFromChanges(files, diffs, classifications);
    
    return {
      hunks,
      summaries,
      classifications,
    };
  } catch (error) {
    return {
      error: `File analysis failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
