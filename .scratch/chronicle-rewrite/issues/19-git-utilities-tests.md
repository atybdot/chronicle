# 19 — Git Utilities Tests

**What to build:** Tests for git utilities including hunk ID stability, patch resolution, and staging operations.

**Blocked by:** 02 (Git Utilities)

**Status:** done

**Context:** These tests verify that hunk IDs are deterministic, patches resolve correctly, and staging operations work as expected. Uses temp git repos for isolation.

**Location:** Create `apps/cli/src/lib/__tests__/git-utilities.test.ts`.

**Test cases to implement:**

1. **Hunk ID Stability**
   - Same diff content produces same hunk ID across runs
   - Different diff content produces different hunk IDs
   - Hunk ID is consistent regardless of file position in diff
   - Hunk ID is consistent regardless of surrounding context

2. **Patch Resolution**
   - `resolveHunkIdToPatch` finds correct hunk in file diffs
   - `resolveHunkIdToPatch` returns null for unknown hunk ID
   - `resolveHunkIdToPatch` handles renamed files
   - `resolveHunkIdToPatch` handles deleted files

3. **Staging Operations**
   - `stageHunksByIds` stages only specified hunks (verify via `git diff --cached`)
   - `stageHunksByIds` returns error if hunk ID not found
   - `unstageAll` clears staging area completely
   - Staging respects file boundaries (doesn't stage unrelated hunks in same file)

4. **Diff Retrieval**
   - `getDiffs()` returns current uncommitted changes
   - `getDiffs()` returns empty array for clean repo
   - `getDiffs()` includes per-hunk content for ID computation
   - `getDiffs(commitHash)` returns diffs between two commits

5. **Integration with Real Git**
   - Create temp git repo
   - Make changes (add, modify, delete files)
   - Verify hunk IDs are stable across multiple `getDiffs()` calls
   - Verify staging + commit works correctly
   - Verify rollback (unstage + reset) works correctly

**Acceptance criteria:**

- [ ] Hunk IDs are deterministic (same content → same ID)
- [ ] Hunk IDs are unique for different content
- [ ] Patch resolution finds correct hunk
- [ ] Staging only stages specified hunks
- [ ] Staging errors are properly reported
- [ ] Unstaging clears the index completely
- [ ] All tests use temp git repos (no side effects on real repos)
- [ ] Tests clean up temp directories after completion
- [ ] Tests are isolated (no shared state between tests)
