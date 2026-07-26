// This file is kept for backward compatibility.
// All functionality has been moved to the git/ directory.
// Please import from "../lib/git" which will resolve to git/index.ts

export { coerceShellOutput, formatGitCommandOutput, isGitHookError } from "./git/helpers";
export { computeHunkId, parseDiffs } from "./git/diff-parser";
export type { FileDiff, HunkDiff } from "./git/diff-parser";
export { resolveHunkIdToPatch, stageHunksByIds, stageFullFile, createCommitWithDate, rollbackHunks, getDiffs } from "./git/patch";
export type { PatchData, GitResult } from "./git/patch";
export {
  isGitRepo,
  getGitRoot,
  getGitStatus,
  getDiff,
  getFileDiff,
  getFileDiffFromHead,
  getFileContent,
  getFileBytes,
  getRecentCommits,
  stageFiles,
  stageFileHunks,
  createCommit,
  unstageAll,
  listFiles,
  getFileChanges,
} from "./git/operations";
export type { GitStatus, GitCommit, StagedHunkResult } from "./git/operations";
