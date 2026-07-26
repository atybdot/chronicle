# 31 — Fix Mixed Sync/Async in writeLedger

**What to build:** Make `writeLedger` fully async to avoid potential race conditions.

**Blocked by:** 03 (Hunk Ledger must be implemented first)

**Status:** done

**Context:** The code review found that `writeLedger` mixes `Bun.write()` (async) with `fs.mkdirSync` and `fs.renameSync` (sync). This is inconsistent and could cause issues if Bun changes rename semantics.

Current structure:

```typescript
export async function writeLedger(ledger: HunkLedger, repoRoot: string): Promise<LedgerResult<void>> {
  // ...
  try {
    // Create .chronicle directory if it doesn't exist
    if (!fs.existsSync(chronicleDir)) {
      fs.mkdirSync(chronicleDir, { recursive: true });  // SYNC
    }

    // Write to temp file first
    await Bun.write(tempPath, JSON.stringify(ledger, null, 2));  // ASYNC

    // Rename temp file to final path (atomic on most filesystems)
    fs.renameSync(tempPath, ledgerPath);  // SYNC

    return { ok: true, value: undefined };
  } catch (error) {
    // Clean up temp file if it exists
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);  // SYNC
      }
    } catch {
      // Ignore cleanup errors
    }
    // ...
  }
}
```

**What to do:**

1. Replace `fs.mkdirSync` with `await fs.promises.mkdir`
2. Replace `fs.renameSync` with `await fs.promises.rename`
3. Replace `fs.existsSync` + `fs.unlinkSync` with `await fs.promises.unlink` wrapped in try-catch
4. Remove `import * as fs from "fs"` if no longer needed (use `import { promises as fs } from "fs"`)

**Acceptance criteria:**

- [ ] `writeLedger` is fully async
- [ ] No sync filesystem operations in the write path
- [ ] All tests pass
