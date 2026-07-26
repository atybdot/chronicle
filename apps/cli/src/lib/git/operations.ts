import { $ } from "bun";
import type { FileChange, FileHunkSpec } from "../../types";
import { parseDiffIntoHunks, createPartialPatch, stagePartialPatch, getHunksByRange } from "../hunks";
import { coerceShellOutput, formatGitCommandOutput } from "./helpers";

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
 * Parse single-character git status code into FileChange status
 */
function parseGitStatus(statusCode: string): FileChange["status"] {
  switch (statusCode) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "M":
    default:
      return "modified";
  }
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
        await stagePartialPatch(patch, gitRoot);
        filesStaged.push(fileHunk.path);
      }
      continue;
    }

    const patch = createPartialPatch(fileHunksData, hunkIndices);
    if (patch) {
      await stagePartialPatch(patch, gitRoot);
      filesStaged.push(fileHunk.path);
    }
  }

  return { success: true, filesStaged };
}

/**
 * Create a commit with the given message and date
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
    throw new Error(`git commit failed${errorDetails ? `\n\n${errorDetails}` : ""}`);
  }

  // Get the commit hash after commit is created
  const hash = await $`git rev-parse HEAD`.cwd(workdir).text();
  return hash.trim();
}

/**
 * Unstage all files (reset index to HEAD)
 */
export async function unstageAll(cwd?: string): Promise<void> {
  const workdir = cwd ?? process.cwd();
  const gitRoot = await getGitRoot(workdir);

  // Check if there are any commits
  try {
    await $`git rev-parse HEAD`.cwd(gitRoot).quiet();
  } catch {
    // No commits yet, nothing to unstage
    return;
  }

  await $`git reset HEAD`.cwd(gitRoot).quiet();
}

/**
 * List all files in the repository
 */
export async function listFiles(cwd?: string): Promise<string[]> {
  const workdir = cwd ?? process.cwd();

  try {
    const result = await $`git ls-files`.cwd(workdir).text();
    return result.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Get file changes between two commits or working tree
 */
export async function getFileChanges(
  fromRef?: string,
  toRef?: string,
  cwd?: string,
): Promise<FileChange[]> {
  const workdir = cwd ?? process.cwd();

  try {
    const args = fromRef
      ? toRef
        ? `${fromRef} ${toRef}`
        : `${fromRef} HEAD`
      : "HEAD";

    const result = await $`git diff --name-status ${args}`.cwd(workdir).text();

    return result
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [status, ...pathParts] = line.split("\t");
        const path = pathParts.join("\t");
        const oldPath = status?.startsWith("R") ? pathParts[0] : undefined;

        return {
          path: oldPath ? pathParts[1] ?? path : path,
          status: parseGitStatus(status ?? "M"),
          oldPath,
        };
      });
  } catch {
    return [];
  }
}
