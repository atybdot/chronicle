# 03 — Hunk Ledger

**What to build:** A local JSON state file that tracks the lifecycle of every hunk through the backfill process, ensuring each hunk is staged and committed exactly once.

**Blocked by:** 01 (needs `HunkLedger` type)

**Status:** done

**Context:** The Hunk Ledger is a pure state machine stored at `.chronicle/hunk-ledger.json` in the repo root. It tracks which hunk IDs have been committed so that:
1. No hunk is committed twice
2. Resume knows where to pick up
3. Rollback can undo the last batch without losing the committed record

Read the spec at `/home/curtain/development/projects/chronicle/spec.md` section "Hunk Ledger" for the full state machine definition.

**Location:** Create a new file `apps/cli/src/lib/hunk-ledger.ts`.

**Functions to implement:**

- `readLedger(repoRoot: string): Result<HunkLedger>` — Reads `.chronicle/hunk-ledger.json` from the repo root. Returns `NotFound` result if file doesn't exist (this is normal for first run).
- `writeLedger(ledger: HunkLedger, repoRoot: string): Result<void>` — Writes the ledger to disk atomically (write to temp file, then rename).
- `initializeLedger(hunkIds: string[], repoRoot: string): Result<HunkLedger>` — Creates a new ledger with the given hunk IDs, all in `pending` state. If ledger already exists, returns the existing one (idempotent).
- `markCommitted(hunkIds: string[], ledger: HunkLedger): Result<HunkLedger>` — Moves hunk IDs from pending to committed. Returns new ledger object (immutable update).
- `rollbackHunks(hunkIds: string[], ledger: HunkLedger): Result<HunkLedger>` — Moves hunk IDs from committed back to pending. Used for rollback.
- `verifyHunksPending(hunkIds: string[], ledger: HunkLedger): Result<string[]>` — Returns the subset of hunk IDs that are still pending. Used to filter out already-committed hunks before execution.
- `getCommittedHunks(ledger: HunkLedger): string[]` — Returns all committed hunk IDs. Used by resume logic.

**Key constraints:**
- The ledger file is repo-local (inside `.chronicle/`)
- `.chronicle/` should be in `.gitignore`
- The ledger is immutable from the caller's perspective — functions return new objects, never mutate in place
- `version` field in ledger is currently 1 (for future schema migrations)

**Acceptance criteria:**

- [ ] `readLedger` returns `NotFound` for repos without a ledger (not an error)
- [ ] `writeLedger` creates the `.chronicle/` directory if it doesn't exist
- [ ] `initializeLedger` is idempotent — calling it twice with same hunk IDs returns the same ledger
- [ ] `markCommitted` moves hunk IDs from pending to committed
- [ ] `markCommitted` returns error if hunk IDs are not in pending state
- [ ] `rollbackHunks` moves hunk IDs from committed back to pending
- [ ] `verifyHunksPending` correctly filters already-committed hunks
- [ ] `readLedger` / `writeLedger` round-trips correctly (write, read back, verify same content)
- [ ] Functions are pure where possible (no side effects beyond file I/O)
- [ ] Ledger file is written atomically (no partial writes on crash)
