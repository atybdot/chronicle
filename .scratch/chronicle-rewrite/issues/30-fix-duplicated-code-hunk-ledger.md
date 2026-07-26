# 30 — Fix Duplicated Code in Hunk Ledger

**What to build:** Extract a `transitionHunks` helper to unify `markCommitted` and `rollbackHunks`.

**Blocked by:** 03 (Hunk Ledger must be implemented first)

**Status:** done

**Context:** The code review found that `markCommitted` and `rollbackHunks` are structurally identical — only the status string and commitId field differ. This violates the DRY principle and makes maintenance harder.

Current structure:

```typescript
// markCommitted (L135-173)
const notPending = hunkIds.filter((id) => {
  const hunk = ledger.hunks[id];
  return !hunk || hunk.status !== "pending";
});
if (notPending.length > 0) {
  return { ok: false, error: `Hunk IDs not pending: ${notPending.join(", ")}` };
}
const newHunks = { ...ledger.hunks };
for (const hunkId of hunkIds) {
  const hunk = newHunks[hunkId];
  if (hunk) {
    newHunks[hunkId] = { ...hunk, status: "committed", commitId };
  }
}
return { ok: true, value: { ...ledger, hunks: newHunks } };

// rollbackHunks (L179-216) — identical structure, different status/commitId
```

**What to do:**

1. Create a `transitionHunks` helper function that takes:
   - `hunkIds: string[]`
   - `ledger: HunkLedger`
   - `targetStatus: "pending" | "committed"`
   - `commitId: string | null`
   - `requiredCurrentStatus: "pending" | "committed"`
   - `errorMessage: string`
2. Refactor `markCommitted` and `rollbackHunks` to use this helper
3. Keep the public API unchanged

**Acceptance criteria:**

- [ ] `transitionHunks` helper is created
- [ ] `markCommitted` uses `transitionHunks`
- [ ] `rollbackHunks` uses `transitionHunks`
- [ ] Public API is unchanged
- [ ] All tests pass
