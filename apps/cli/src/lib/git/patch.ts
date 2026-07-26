import { $ } from "bun";
import type { FileDiff, HunkDiff } from "./diff-parser";
import { computeHunkId } from "./diff-parser";
import { getGitRoot } from "./operations";
import { formatGitCommandOutput } from "./helpers";

export interface PatchData {
  filePath: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed";
  patch: string;
}

export type GitResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Find a hunk by its ID and return patch data suitable for git apply.
 * Handles renames correctly by using oldPath for --- and filePath for +++.
 */
export function resolveHunkIdToPatch(hunkId: string, diffs: FileDiff[]): PatchData | null {
  for (const fileDiff of diffs) {
    for (const hunk of fileDiff.hunks) {
      const hunkContent = hunk.header + "\n" + hunk.content;
      const computedId = computeHunkId(hunkContent);

      if (computedId === hunkId) {
        // Build patch data with correct paths for renames
        const patchLines: string[] = [];
        patchLines.push(`diff --git a/${fileDiff.oldPath ?? fileDiff.filePath} b/${fileDiff.filePath}`);
        patchLines.push(`--- a/${fileDiff.oldPath ?? fileDiff.filePath}`);
        patchLines.push(`+++ b/${fileDiff.filePath}`);
        patchLines.push(hunk.header);
        patchLines.push(hunk.content);

        return {
          filePath: fileDiff.filePath,
          oldPath: fileDiff.oldPath,
          status: fileDiff.status,
          patch: patchLines.join("\n"),
        };
      }
    }
  }
  return null;
}

/**
 * Stage specific hunks by their IDs without resetting index.
 * This allows incremental staging for sequential commit groups.
 */
export async function stageHunksByIds(
  hunkIds: string[],
  diffs: FileDiff[],
  cwd?: string,
): Promise<GitResult<void>> {
  const workdir = cwd ?? process.cwd();
  const gitRoot = await getGitRoot(workdir);

  // Find all patches
  const patches: PatchData[] = [];
  const missingIds: string[] = [];

  for (const hunkId of hunkIds) {
    const patch = resolveHunkIdToPatch(hunkId, diffs);
    if (patch) {
      patches.push(patch);
    } else {
      missingIds.push(hunkId);
    }
  }

  if (missingIds.length > 0) {
    return {
      ok: false,
      error: `Hunk IDs not found: ${missingIds.join(", ")}`,
    };
  }

  // Apply each patch without resetting index
  for (const patch of patches) {
    try {
      // Write patch to temp file and apply
      const patchFile = `${gitRoot}/.chronicle-temp-patch.patch`;
      await Bun.write(patchFile, patch.patch);
      await $`git apply --cached ${patchFile}`.cwd(gitRoot);
      await Bun.file(patchFile).unlink();
    } catch (error) {
      return {
        ok: false,
        error: `Failed to apply patch for ${patch.filePath}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return { ok: true, value: undefined };
}

/**
 * Stage a full file by path.
 */
export async function stageFullFile(
  filePath: string,
  cwd?: string,
): Promise<GitResult<void>> {
  const workdir = cwd ?? process.cwd();
  const gitRoot = await getGitRoot(workdir);

  try {
    await $`git add -- ${filePath}`.cwd(gitRoot);
    return { ok: true, value: undefined };
  } catch (error) {
    return {
      ok: false,
      error: `Failed to stage file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Create a commit with specific date and author.
 */
export async function createCommitWithDate(
  message: string,
  date: Date,
  authorName?: string,
  authorEmail?: string,
  noVerify = false,
  cwd?: string,
): Promise<GitResult<string>> {
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
      return {
        ok: false,
        error: "Git author identity not configured.\n\n" +
          "Please configure Git with your identity:\n" +
          "  git config --global user.name \"Your Name\"\n" +
          "  git config --global user.email \"your.email@example.com\"\n\n" +
          "Or set them in the chronicle config:\n" +
          "  chronicle config set git.authorName \"Your Name\"\n" +
          "  chronicle config set git.authorEmail \"your.email@example.com\"" +
          (gitOutput ? `\n\nGit output:\n${gitOutput}` : ""),
      };
    }
    return {
      ok: false,
      error: `git commit failed${errorDetails ? `\n\n${errorDetails}` : ""}`,
    };
  }

  // Get the commit hash after commit is created
  const hashResult = await $`git rev-parse HEAD`.cwd(workdir).text();
  return { ok: true, value: hashResult.trim() };
}

/**
 * Rollback hunks by unstaging them and resetting to HEAD.
 */
export async function rollbackHunks(
  hunkIds: string[],
  cwd?: string,
): Promise<GitResult<void>> {
  const workdir = cwd ?? process.cwd();
  const gitRoot = await getGitRoot(workdir);

  try {
    // Reset index to HEAD to unstage everything
    await $`git reset HEAD`.cwd(gitRoot).quiet();
    return { ok: true, value: undefined };
  } catch (error) {
    return {
      ok: false,
      error: `Failed to rollback hunks: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get current uncommitted diffs (or diffs between two commits).
 */
export async function getDiffs(commitHash?: string, cwd?: string): Promise<FileDiff[]> {
  const workdir = cwd ?? process.cwd();

  let diffText: string;
  if (commitHash) {
    // Get diffs between commit and HEAD
    diffText = await $`git diff ${commitHash} HEAD`.cwd(workdir).text();
  } else {
    // Get current uncommitted diffs
    diffText = await $`git diff HEAD`.cwd(workdir).text();
  }

  const { parseDiffs } = await import("./diff-parser");
  return parseDiffs(diffText);
}
