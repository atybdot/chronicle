# 02 — Git Utilities

**What to build:** Extended git operations that support the hunk-ID-based staging model. Builds on the existing git utilities in `apps/cli/src/lib/git.ts`.

**Blocked by:** 01 (needs `Hunk`, `HunkSummary`, `FileChange` types)

**Status:** done

**Context:** The existing `git.ts` has operations like `getStatus`, `stageHunks`, `commit`, `createBranch`, `checkout`. You are adding new functions while keeping the existing ones intact. The new staging model uses content-based hunk IDs (SHA-256 of hunk diff content) so that the same logical hunk always maps to the same ID regardless of where it appears in the diff output.

Read the existing `apps/cli/src/lib/git.ts` first to understand the current implementation. The spec at `/home/curtain/development/projects/chronicle/spec.md` section "Git Operations" defines the staging model precisely.

**New functions to implement:**

- `computeHunkId(diffContent: string): string` — SHA-256 hash of the hunk diff content string. Must be deterministic: same content → same ID across runs.
- `resolveHunkIdToPatch(hunkId: string, diffs: FileDiff[]): PatchData | null` — Given a hunk ID and the current file diffs, find the matching hunk and return patch data suitable for `git apply`. Returns null if hunk not found.
- `stageHunksByIds(hunkIds: string[], diffs: FileDiff[]): Result<void>` — Stages specific hunks by their IDs. Uses `resolveHunkIdToPatch` to find patches, applies them. If any hunk ID is not found in diffs, returns an error.
- `getDiffs(commitHash?: string): FileDiff[]` — Returns the current uncommitted diffs (or diffs between two commits). Each `FileDiff` includes the raw diff text per hunk so hunk IDs can be computed from it.
- `unstageAll(): Result<void>` — Stages nothing (resets index to HEAD). Used for rollback.

**Key implementation detail:** The staging approach is: reset index to HEAD, then apply only the specific hunks we want via `git apply --cached` with patch data. This avoids staging entire files and ensures only selected hunks appear in the commit.

**Acceptance criteria:**

- [ ] `computeHunkId` produces consistent SHA-256 hashes for the same input across runs
- [ ] `computeHunkId` produces different hashes for different inputs
- [ ] `resolveHunkIdToPatch` finds the correct hunk in a list of file diffs
- [ ] `resolveHunkIdToPatch` returns null for unknown hunk IDs
- [ ] `stageHunksByIds` stages only the specified hunks (test by checking git diff --cached after staging)
- [ ] `stageHunksByIds` returns error if any hunk ID is missing from diffs
- [ ] `getDiffs()` returns current uncommitted changes with per-hunk content
- [ ] `unstageAll()` clears the staging area completely
- [ ] All existing git operations in `git.ts` still work unchanged
- [ ] Functions are pure where possible (no side effects beyond git commands)
