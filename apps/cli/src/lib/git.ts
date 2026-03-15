import { $ } from "bun";
import type { FileChange, FileHunkSpec } from "../types";
import { parseDiffIntoHunks, createPartialPatch, stagePartialPatch, getHunksByRange } from "./hunks";

export interface GitStatus {
  staged: FileChange[];
  unstaged: FileChange[];
  untracked: string[];
}

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: Date;
}

function coerceShellOutput(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value instanceof Uint8Array) return new TextDecoder().decode(value).trim();
  if (value == null) return "";
  return String(value).trim();
}

function formatGitCommandOutput(error: unknown): string {
  if (!error || typeof error !== "object") return "";

  const shellError = error as { stdout?: unknown; stderr?: unknown };
  const stderr = coerceShellOutput(shellError.stderr);
  const stdout = coerceShellOutput(shellError.stdout);
  const sections: string[] = [];

  if (stderr) sections.push(`stderr:\n${stderr}`);
  if (stdout) sections.push(`stdout:\n${stdout}`);

  return sections.join("\n\n");
}

const GIT_HOOK_ERROR_PATTERNS = [
  /husky/i,
  /pre-commit/i,
  /commit-msg/i,
  /lint-staged/i,
  /prepare-commit-msg/i,
  /post-commit/i,
  /hooks\/(pre-commit|commit-msg|prepare-commit-msg|post-commit)/i,
  /git hook/i,
  /hook failed/i,
  /hook declined/i,
];

export function isGitHookError(message: string): boolean {
  return GIT_HOOK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Check if current directory is a git repository
 */
export async function isGitRepo(cwd?: string): Promise<boolean> {
  try {
    const result = await $`git rev-parse --is-inside-work-tree`.cwd(cwd ?? process.cwd()).quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Get the root directory of the git repository
 */
export async function getGitRoot(cwd?: string): Promise<string> {
  const result = await $`git rev-parse --show-toplevel`.cwd(cwd ?? process.cwd()).text();
  return result.trim();
}

/**
 * Get current git status (staged, unstaged, untracked files)
 */
export async function getGitStatus(cwd?: string): Promise<GitStatus> {
  const workdir = cwd ?? process.cwd();

  // Get porcelain status for parsing
  const statusOutput = await $`git status --porcelain=v1`.cwd(workdir).text();

  const staged: FileChange[] = [];
  const unstaged: FileChange[] = [];
  const untracked: string[] = [];

  const lines = statusOutput.split("\n").filter((line) => line.length >= 2);

  for (const line of lines) {
    const indexStatus = line[0];
    const workTreeStatus = line[1];
    const filePath = line.slice(3).trim();

    // Handle renames (format: "R  old -> new")
    let actualPath = filePath;
    let oldPath: string | undefined;
    if (filePath.includes(" -> ")) {
      const parts = filePath.split(" -> ");
      oldPath = parts[0] ?? "";
      actualPath = parts[1] ?? filePath;
    }

    // Untracked files
    if (indexStatus === "?" && workTreeStatus === "?") {
      untracked.push(actualPath);
      continue;
    }

    // Staged changes
    if (indexStatus !== " " && indexStatus !== "?" && indexStatus) {
      staged.push({
        path: actualPath,
        status: parseGitStatus(indexStatus),
        oldPath,
      });
    }

    // Unstaged changes (working tree)
    if (workTreeStatus !== " " && workTreeStatus !== "?" && workTreeStatus) {
      unstaged.push({
        path: actualPath,
        status: parseGitStatus(workTreeStatus),
        oldPath,
      });
    }
  }

  return { staged, unstaged, untracked };
}

/**
 * Get diff for specific files or all changes
 */
export async function getDiff(files?: string[], staged = false, cwd?: string): Promise<string> {
  const workdir = cwd ?? process.cwd();
  const args = staged ? ["--cached"] : [];

  if (files && files.length > 0) {
    const result = await $`git diff ${args} -- ${files}`.cwd(workdir).text();
    return result;
  }

  const result = await $`git diff ${args}`.cwd(workdir).text();
  return result;
}

/**
 * Get diff for a specific file
 */
export async function getFileDiff(filePath: string, staged = false, cwd?: string): Promise<string> {
  const workdir = cwd ?? process.cwd();
  const args = staged ? ["--cached"] : [];

  try {
    const result = await $`git diff ${args} -- ${filePath}`.cwd(workdir).text();
    return result;
  } catch {
    return "";
  }
}

/**
 * Get full diff for a file against HEAD (includes staged + unstaged)
 */
export async function getFileDiffFromHead(filePath: string, cwd?: string): Promise<string> {
  const workdir = cwd ?? process.cwd();

  try {
    const result = await $`git diff HEAD -- ${filePath}`.cwd(workdir).text();
    return result;
  } catch {
    return "";
  }
}

/**
 * Get content of untracked file
 */
export async function getFileContent(filePath: string, cwd?: string): Promise<string> {
  const workdir = cwd ?? process.cwd();
  const fullPath = `${workdir}/${filePath}`;

  try {
    const file = Bun.file(fullPath);
    return await file.text();
  } catch {
    return "";
  }
}

/**
 * Get raw bytes for an untracked file
 */
export async function getFileBytes(filePath: string, cwd?: string): Promise<Uint8Array> {
  const workdir = cwd ?? process.cwd();
  const fullPath = `${workdir}/${filePath}`;

  try {
    const file = Bun.file(fullPath);
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    return new Uint8Array();
  }
}

/**
 * Get recent commits for style reference
 */
export async function getRecentCommits(count = 10, cwd?: string): Promise<GitCommit[]> {
  const workdir = cwd ?? process.cwd();

  try {
    const result = await $`git log -${count} --format="%H|%s|%an|%aI"`.cwd(workdir).text();

    return result
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash = "", message = "", author = "", date = ""] = line.split("|");
        return {
          hash,
          message,
          author,
          date: new Date(date),
        };
      });
  } catch {
    return [];
  }
}

/**
 * Stage specific files
 * Returns the list of files that were actually staged
 */
export async function stageFiles(files: string[], cwd?: string): Promise<string[]> {
  const workdir = cwd ?? process.cwd();
  const gitRoot = await getGitRoot(workdir);

  if (files.length > 0) {
    // Run git add from the git root directory since paths are relative to it
    // git add handles both existing files and deleted files (stages the deletion)
    await $`git add -- ${files}`.cwd(gitRoot);
  }

  return files;
}

export interface StagedHunkResult {
  success: boolean;
  filesStaged: string[];
  error?: string;
}

export async function stageFileHunks(
  fileHunks: FileHunkSpec[],
  diffs: Map<string, string>,
  cwd?: string,
): Promise<StagedHunkResult> {
  const workdir = cwd ?? process.cwd();
  const gitRoot = await getGitRoot(workdir);
  const filesStaged: string[] = [];

  for (const fileHunk of fileHunks) {
    const diff = diffs.get(fileHunk.path);

    if (!diff) {
      await $`git add -- ${fileHunk.path}`.cwd(gitRoot);
      filesStaged.push(fileHunk.path);
      continue;
    }

    if (fileHunk.hunks.length === 0) {
      continue;
    }

    const fileHunksData = parseDiffIntoHunks(diff, fileHunk.path, "modified");

    if (fileHunksData.isNewFile) {
      await $`git add -- ${fileHunk.path}`.cwd(gitRoot);
      filesStaged.push(fileHunk.path);
      continue;
    }

    if (fileHunksData.isDeletedFile) {
      await $`git add -- ${fileHunk.path}`.cwd(gitRoot);
      filesStaged.push(fileHunk.path);
      continue;
    }

    const hunkIndices = getHunksByRange(fileHunksData, fileHunk.hunks);

    if (hunkIndices.length === 0) {
      const allHunkIndices = fileHunksData.hunks.map((_, i) => i);
      const patch = createPartialPatch(fileHunksData, allHunkIndices);
      if (patch) {
        const success = await stagePartialPatch(patch, gitRoot);
        if (success) {
          filesStaged.push(fileHunk.path);
        }
      }
      continue;
    }

    const patch = createPartialPatch(fileHunksData, hunkIndices);

    if (patch) {
      const success = await stagePartialPatch(patch, gitRoot);
      if (success) {
        filesStaged.push(fileHunk.path);
      }
    }
  }

  return {
    success: filesStaged.length > 0,
    filesStaged,
  };
}

/**
 * Stage specific hunks by their indices - more reliable than line ranges
 */
export async function stageFileHunksByIndex(
  fileHunks: FileHunkSpec[],
  diffs: Map<string, string>,
  cwd?: string,
): Promise<StagedHunkResult> {
  const workdir = cwd ?? process.cwd();
  const gitRoot = await getGitRoot(workdir);
  const filesStaged: string[] = [];

  for (const fileHunk of fileHunks) {
    const diff = diffs.get(fileHunk.path);

    if (!diff) {
      await $`git add -- ${fileHunk.path}`.cwd(gitRoot);
      filesStaged.push(fileHunk.path);
      continue;
    }

    // Use hunkIndices if available, otherwise fall back to line ranges
    const indices = fileHunk.hunkIndices;
    if (!indices || indices.length === 0) {
      // Fall back to the original method
      const result = await stageFileHunks([fileHunk], diffs, cwd);
      if (result.success) {
        filesStaged.push(...result.filesStaged);
      }
      continue;
    }

    const fileHunksData = parseDiffIntoHunks(diff, fileHunk.path, "modified");

    if (fileHunksData.isNewFile) {
      await $`git add -- ${fileHunk.path}`.cwd(gitRoot);
      filesStaged.push(fileHunk.path);
      continue;
    }

    if (fileHunksData.isDeletedFile) {
      await $`git add -- ${fileHunk.path}`.cwd(gitRoot);
      filesStaged.push(fileHunk.path);
      continue;
    }

    // Use the provided hunk indices directly
    const validIndices = indices.filter(i => i >= 0 && i < fileHunksData.hunks.length);

    if (validIndices.length === 0) {
      console.warn(`No valid hunk indices for ${fileHunk.path}`);
      continue;
    }

    const patch = createPartialPatch(fileHunksData, validIndices);

    if (patch) {
      const success = await stagePartialPatch(patch, gitRoot);
      if (success) {
        filesStaged.push(fileHunk.path);
      }
    }
  }

  return {
    success: filesStaged.length > 0,
    filesStaged,
  };
}

/**
 * Check if there are any staged changes
 */
export async function hasStagedChanges(cwd?: string): Promise<boolean> {
  const workdir = cwd ?? process.cwd();
  try {
    const result = await $`git diff --cached --quiet`.cwd(workdir).quiet();
    // Exit code 0 means no changes, 1 means there are changes
    return result.exitCode !== 0;
  } catch {
    // Exit code 1 means there are staged changes
    return true;
  }
}

/**
 * Unstage all files
 */
export async function unstageAll(cwd?: string): Promise<void> {
  const workdir = cwd ?? process.cwd();

  // Check if there are any commits
  try {
    await $`git rev-parse HEAD`.cwd(workdir).quiet();
  } catch {
    // No commits yet, nothing to unstage
    return;
  }

  await $`git reset HEAD`.cwd(workdir).quiet();
}

/**
 * Create a commit with specific date
 */
export async function createCommit(
  message: string,
  date: Date,
  authorName?: string,
  authorEmail?: string,
  cwd?: string,
  noVerify = false,
): Promise<string> {
  const workdir = cwd ?? process.cwd();
  const isoDate = date.toISOString();

  // Merge with existing environment to preserve HOME and other necessary vars
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    GIT_AUTHOR_DATE: isoDate,
    GIT_COMMITTER_DATE: isoDate,
  };

  if (authorName) {
    env.GIT_AUTHOR_NAME = authorName;
    env.GIT_COMMITTER_NAME = authorName;
  }
  if (authorEmail) {
    env.GIT_AUTHOR_EMAIL = authorEmail;
    env.GIT_COMMITTER_EMAIL = authorEmail;
  }

  try {
    const commitArgs = noVerify ? ["--no-verify"] : [];
    await $`git commit ${commitArgs} -m ${message}`.cwd(workdir).env(env).text();
  } catch (error) {
    const gitOutput = formatGitCommandOutput(error);
    const errorDetails = [error instanceof Error ? error.message.trim() : "", gitOutput].filter(Boolean).join("\n\n");

    // Check if this is an author identity error
    const errorStr = errorDetails || String(error);
    if (errorStr.includes("Author identity unknown") || errorStr.includes("user.email") || errorStr.includes("user.name")) {
      throw new Error(
        "Git author identity not configured.\n\n" +
        "Please configure Git with your identity:\n" +
        "  git config --global user.name \"Your Name\"\n" +
        "  git config --global user.email \"your.email@example.com\"\n\n" +
        "Or set them in the chronicle config:\n" +
        "  chronicle config set git.authorName \"Your Name\"\n" +
        "  chronicle config set git.authorEmail \"your.email@example.com\"" +
        (gitOutput ? `\n\nGit output:\n${gitOutput}` : "")
      );
    }
    throw new Error(`git commit failed${errorDetails ? `\n\n${errorDetails}` : ""}`);
  }

  // Get the commit hash after commit is created
  const hashResult = await $`git rev-parse HEAD`.cwd(workdir).text();
  return hashResult.trim();
}

/**
 * Create a backup branch of current state
 */
export async function createBackupBranch(cwd?: string): Promise<string | null> {
  const workdir = cwd ?? process.cwd();

  // Check if there are any commits
  try {
    await $`git rev-parse HEAD`.cwd(workdir).quiet();
  } catch {
    // No commits yet, can't create backup branch
    return null;
  }

  const branchName = `chronicle-backup-${Date.now()}`;
  await $`git branch ${branchName}`.cwd(workdir);
  return branchName;
}

/**
 * Get current branch name
 */
export async function getCurrentBranch(cwd?: string): Promise<string> {
  const workdir = cwd ?? process.cwd();
  const result = await $`git branch --show-current`.cwd(workdir).text();
  return result.trim();
}

/**
 * Check if there are any changes to commit
 */
export async function hasChanges(cwd?: string): Promise<boolean> {
  const status = await getGitStatus(cwd);
  return status.staged.length > 0 || status.unstaged.length > 0 || status.untracked.length > 0;
}

/**
 * Get git config value
 */
export async function getGitConfig(key: string, cwd?: string): Promise<string | null> {
  const workdir = cwd ?? process.cwd();
  try {
    const result = await $`git config --get ${key}`.cwd(workdir).text();
    return result.trim();
  } catch {
    return null;
  }
}

/**
 * Set git config value
 */
export async function setGitConfig(key: string, value: string, cwd?: string): Promise<void> {
  const workdir = cwd ?? process.cwd();
  await $`git config ${key} ${value}`.cwd(workdir);
}

/**
 * Check if git user identity is configured
 */
export async function hasGitIdentity(cwd?: string): Promise<boolean> {
  const name = await getGitConfig("user.name", cwd);
  const email = await getGitConfig("user.email", cwd);
  return !!name && !!email;
}

/**
 * Get git user identity
 */
export async function getGitIdentity(cwd?: string): Promise<{ name: string | null; email: string | null }> {
  const name = await getGitConfig("user.name", cwd);
  const email = await getGitConfig("user.email", cwd);
  return { name, email };
}

// Helper function to parse git status codes
function parseGitStatus(code: string): "added" | "modified" | "deleted" | "renamed" {
  switch (code) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    default:
      return "modified";
  }
}
