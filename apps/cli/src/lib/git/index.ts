// Re-export all git utilities for backward compatibility
export { coerceShellOutput, formatGitCommandOutput, isGitHookError } from "./helpers";
export { computeHunkId, parseDiffs } from "./diff-parser";
export type { FileDiff, HunkDiff } from "./diff-parser";
export { resolveHunkIdToPatch, stageHunksByIds, stageFullFile, createCommitWithDate, rollbackHunks, getDiffs } from "./patch";
export type { PatchData, GitResult } from "./patch";
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
} from "./operations";
export type { GitStatus, GitCommit, StagedHunkResult } from "./operations";
