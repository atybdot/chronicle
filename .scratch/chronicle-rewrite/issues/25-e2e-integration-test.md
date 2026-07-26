# 25 — E2E Integration Test

**What to build:** Full pipeline integration test with mocked AI at the transport level, covering happy path, partial execution resume, cache hit, and hook failure with retry.

**Blocked by:** 02 (Git Utilities), 16 (CLI Command)

**Status:** ready-for-agent

**Context:** This is the end-to-end test that exercises the complete pipeline from CLI invocation to git commits. It mocks AI at the transport level (Vercel AI SDK) so the test is deterministic but exercises all real code paths.

**Location:** Create `apps/cli/src/__tests__/backfill-integration.test.ts`.

**Test setup:**
- Temp git repo with known changes
- Mocked AI responses at transport level (not individual agents)
- Hunk Ledger at `.chronicle/hunk-ledger.json`
- Plan Cache at `~/.cache/chronicle/plans/`

**Test cases to implement:**

1. **Happy Path**
   - Create temp repo with 3 files changed (add, modify, delete)
   - Run backfill with date range
   - Assert: git log has expected commits
   - Assert: Hunk Ledger shows all hunks committed
   - Assert: No uncommitted changes remain
   - Assert: Backup branch exists
   - Assert: Plan cache created

2. **Partial Execution Resume**
   - Create temp repo with 5 files changed
   - Mock AI to fail on 3rd group
   - Run backfill (fails at group 3)
   - Run backfill with `--resume`
   - Assert: First 2 groups committed
   - Assert: Groups 3-5 committed on resume
   - Assert: Ledger consistent across resume

3. **Cache Hit**
   - Create temp repo, run backfill (creates cache)
   - Run backfill again (cache hit)
   - Assert: No agent calls made (cache used)
   - Assert: Same plan as before
   - Assert: Git commits created correctly

4. **Cache Miss on Change**
   - Create temp repo, run backfill (creates cache)
   - Make new changes to repo
   - Run backfill again (cache miss)
   - Assert: Agents are called (new analysis)
   - Assert: New plan includes both old and new changes

5. **Hook Failure with Retry**
   - Create temp repo with pre-commit hook that fails
   - Mock AI to produce valid plan
   - Run backfill
   - Assert: Commits created with `--no-verify` (hook bypassed)
   - Assert: Ledger shows all hunks committed

6. **Dry Run**
   - Create temp repo with changes
   - Run backfill with `--dry-run`
   - Assert: Plan summary is shown
   - Assert: No commits created
   - Assert: No ledger changes
   - Assert: No cache created

**Acceptance criteria:**

- [ ] Happy path creates expected commits
- [ ] Hunk Ledger is consistent after execution
- [ ] Backup branch exists and points to correct commit
- [ ] Partial execution resume works correctly
- [ ] Cache hit skips agent calls
- [ ] Cache miss triggers new analysis
- [ ] Hook failure triggers retry with `--no-verify`
- [ ] Dry run shows plan without executing
- [ ] All tests use temp git repos
- [ ] Tests clean up temp directories
- [ ] Tests are isolated (no shared state)
- [ ] Tests are deterministic (mocked AI)
