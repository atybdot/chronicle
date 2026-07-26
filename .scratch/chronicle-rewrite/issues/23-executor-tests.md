# 23 — Executor Tests

**What to build:** Integration tests for the Executor agent against temp git repos, verifying staging, committing, rollback, and ledger integration.

**Blocked by:** 11 (Executor Agent)

**Status:** done

**Context:** Executor stages hunks via the Hunk Ledger and creates backdated commits. These tests verify the full execution flow using real git operations in temp repos.

**Location:** Create `apps/cli/src/lib/__tests__/executor.test.ts`.

**Test cases to implement:**

1. **Happy Path Execution**
   - Execute single group with single hunk
   - Execute single group with multiple hunks
   - Execute multiple groups in order
   - Verify commits are created with correct timestamps
   - Verify only specified hunks are staged (not entire files)

2. **Ledger Integration**
   - Hunk IDs are marked as committed after successful commit
   - `verifyHunksPending` returns empty after all groups executed
   - Double-stage prevention: same hunk ID not committed twice
   - Ledger state is consistent after execution

3. **Git Hook Failure**
   - Hook failure triggers retry with `--no-verify`
   - If retry fails, group is marked as failed
   - Execution continues with next group
   - Failed group is recorded in execution state

4. **Rollback**
   - Backup branch is created before execution
   - Rollback restores repo to pre-execution state
   - Rollback clears ledger entries made during execution
   - Rollback deletes backup branch after success

5. **Dependency Ordering**
   - Groups execute in correct order (respecting dependencies)
   - Later groups can depend on earlier groups' changes

6. **Edge Cases**
   - All groups fail (no commits made)
   - Single hunk that doesn't apply cleanly (conflict)
   - Empty group (no hunks to stage)
   - Very large group (50+ hunks)

**Acceptance criteria:**

- [ ] Commits are created with correct backdated timestamps
- [ ] Only specified hunks are staged (verified via `git diff --cached`)
- [ ] Hunk IDs are marked as committed in ledger
- [ ] Git hook failures are retried with `--no-verify`
- [ ] Failed groups are recorded in execution state
- [ ] Backup branch is created before execution
- [ ] Rollback restores repo to pre-execution state
- [ ] All tests use temp git repos
- [ ] Tests clean up temp directories
- [ ] Tests are isolated (no shared state between tests)
