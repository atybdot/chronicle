# 17 — Hunk Ledger Tests

**What to build:** Comprehensive tests for the Hunk Ledger pure state machine.

**Blocked by:** 03 (Hunk Ledger implementation)

**Status:** done

**Context:** The Hunk Ledger is a pure state machine with no LLM or git dependencies. These tests verify all state transitions, edge cases, and error handling.

**Location:** Create `apps/cli/src/lib/__tests__/hunk-ledger.test.ts`.

**Test cases to implement:**

1. **Initialization**
   - `initializeLedger` creates a new ledger with all hunk IDs in pending state
   - `initializeLedger` is idempotent — calling twice with same IDs returns same ledger
   - `initializeLedger` sets `version` to 1
   - `initializeLedger` sets `createdAt` and `updatedAt` timestamps

2. **Read/Write Round-trip**
   - `writeLedger` then `readLedger` returns identical content
   - `readLedger` returns `NotFound` for repos without a ledger
   - `writeLedger` creates `.chronicle/` directory if it doesn't exist
   - `writeLedger` writes atomically (no partial writes)

3. **Mark Committed**
   - `markCommitted` moves hunk IDs from pending to committed
   - `markCommitted` returns error if hunk IDs are not in pending state
   - `markCommitted` updates `updatedAt` timestamp
   - `markCommitted` with empty array is a no-op (returns same ledger)

4. **Rollback**
   - `rollbackHunks` moves hunk IDs from committed back to pending
   - `rollbackHunks` returns error if hunk IDs are not in committed state
   - `rollbackHunks` with empty array is a no-op

5. **Verify Pending**
   - `verifyHunksPending` returns only pending hunk IDs
   - `verifyHunksPending` filters out already-committed hunks
   - `verifyHunksPending` with empty array returns empty array
   - `verifyHunksPending` with all committed returns empty array

6. **Get Committed**
   - `getCommittedHunks` returns all committed hunk IDs
   - `getCommittedHunks` returns empty array when nothing committed

7. **Edge Cases**
   - Ledger with 0 hunks
   - Ledger with 1000+ hunks (performance)
   - Concurrent writes (file locking)
   - Corrupted ledger file (invalid JSON)
   - Ledger with unknown fields (forward compatibility)

**Acceptance criteria:**

- [ ] All test cases pass
- [ ] Tests are pure — no git operations, no LLM calls
- [ ] Tests use temp directories for file I/O (no side effects on real repos)
- [ ] Error cases return proper `Result` types (not throw)
- [ ] Tests cover happy path and error paths
- [ ] Tests are fast (< 1 second total)
