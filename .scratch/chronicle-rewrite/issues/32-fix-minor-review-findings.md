# 32 — Fix Minor Code Review Findings

**What to build:** Address remaining minor issues from code review.

**Blocked by:** 03, 04 (both tickets must be implemented first)

**Status:** done

**Context:** The code review found several minor issues:

1. **Duplicated error-handling** — `error instanceof Error ? error.message : String(error)` appears twice in `hunk-ledger.ts`. Extract to a helper.
2. **Unnecessary async** — `verifyHunksPending` is async but is a pure in-memory filter with no I/O. Remove async.
3. **Naming mismatch** — Spec says `version` field, implementation uses `ledgerVersion`. Keep `ledgerVersion` (more explicit) but add a comment.
4. **Missing .gitignore** — Spec says `.chronicle/` should be in `.gitignore`. Add logic to check/update `.gitignore` or document that it's the caller's responsibility.

**What to do:**

1. Create a `formatLedgerError` helper for consistent error formatting
2. Make `verifyHunksPending` synchronous
3. Add comment explaining `ledgerVersion` naming choice
4. Add `.gitignore` handling or document responsibility

**Acceptance criteria:**

- [ ] Error formatting is consistent via helper
- [ ] `verifyHunksPending` is synchronous
- [ ] `ledgerVersion` naming is documented
- [ ] `.gitignore` responsibility is clear
- [ ] All tests pass
