# 11 — Executor Agent

**What to build:** The Executor agent that stages hunks via the Hunk Ledger, creates backdated commits, handles git hook failures, creates backup branches, and rolls back on failure.

**Blocked by:** 01 (types), 02 (git utilities for staging/commit), 03 (hunk ledger for exactly-once tracking)

**Status:** done

**Context:** The Executor is the final worker that turns a plan into git commits. It uses the Hunk Ledger to ensure each hunk is committed exactly once. It handles failures gracefully with rollback.

Read the spec at `/home/curtain/development/projects/chronicle/spec.md` section "Executor Agent" for the full execution flow.

**Location:** Create a new file `apps/cli/src/lib/agents/executor.ts`.

**What Executor does (tool-call driven):**

1. **`execute_group(groupId, group, ledger, config)`** — Executes a single commit group:
   - Verifies all hunk IDs are pending in ledger
   - Stages hunks by ID via `stageHunksByIds`
   - Creates commit with backdated timestamp via `GIT_AUTHOR_DATE` / `GIT_COMMITTER_DATE`
   - Marks hunk IDs as committed in ledger
   - Returns success/failure with commit hash

2. **`handle_hook_failure(groupId, group, ledger, config)`** — Handles git hook failure:
   - Retries with `--no-verify` flag
   - If still fails, marks group as failed and continues
   - Logs the hook error for debugging

3. **`create_backup_branch(repoRoot)`** — Before execution starts, creates a backup branch `chronicle-backup-{timestamp}` pointing to current HEAD. Used for rollback.

4. **`rollback(repoRoot, backupBranch)`** — On catastrophic failure:
   - Resets HEAD to backup branch
   - Deletes any commits made during execution
   - Restores ledger to pre-execution state

5. **`mark_group_failed(groupId, ledger)`** — Marks a group as failed in the ledger without rolling back. Allows resume to retry later.

**Execution flow (from spec):**
1. Create backup branch
2. For each group in order:
   a. Verify hunk IDs are pending
   b. Stage hunks by ID
   c. Create commit with backdated timestamp
   d. Mark hunk IDs as committed
   e. On failure: retry with --no-verify, then mark failed and continue
3. On catastrophic failure: rollback everything

**Acceptance criteria:**

- [ ] Executor stages only the specified hunks (not entire files)
- [ ] Commits are created with correct backdated timestamps
- [ ] Hunk IDs are marked as committed in ledger after successful commit
- [ ] Git hook failures are retried with `--no-verify`
- [ ] If retry also fails, group is marked as failed and execution continues
- [ ] Backup branch is created before execution starts
- [ ] Rollback restores repo to pre-execution state
- [ ] Rollback clears ledger entries made during execution
- [ ] `mark_group_failed` records the failure without rolling back
- [ ] Execution respects group dependency ordering
- [ ] Works with various group sizes (1 hunk, 50+ hunks)
- [ ] Handles edge case: all groups fail (no commits made)
