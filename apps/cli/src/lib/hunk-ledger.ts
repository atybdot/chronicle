import * as fs from "fs";
import * as path from "path";
import type { HunkLedger } from "../types";

export type LedgerResult<T> = { ok: true; value: T } | { ok: false; error: string };

const LEDGER_DIR = ".chronicle";
const LEDGER_FILE = "hunk-ledger.json";

/**
 * Read the hunk ledger from disk.
 * Returns not_found if file doesn't exist (normal for first run).
 */
export async function readLedger(repoRoot: string): Promise<LedgerResult<HunkLedger>> {
  const ledgerPath = path.join(repoRoot, LEDGER_DIR, LEDGER_FILE);

  try {
    const file = Bun.file(ledgerPath);
    const exists = await file.exists();

    if (!exists) {
      return { ok: false, error: "not_found" };
    }

    const content = await file.text();
    const ledger = JSON.parse(content) as HunkLedger;

    return { ok: true, value: ledger };
  } catch (error) {
    return {
      ok: false,
      error: `Failed to read ledger: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Write the ledger to disk atomically.
 * Creates .chronicle directory if it doesn't exist.
 */
export async function writeLedger(ledger: HunkLedger, repoRoot: string): Promise<LedgerResult<void>> {
  const chronicleDir = path.join(repoRoot, LEDGER_DIR);
  const ledgerPath = path.join(chronicleDir, LEDGER_FILE);
  const tempPath = `${ledgerPath}.tmp`;

  try {
    // Create .chronicle directory if it doesn't exist
    if (!fs.existsSync(chronicleDir)) {
      fs.mkdirSync(chronicleDir, { recursive: true });
    }

    // Write to temp file first
    await Bun.write(tempPath, JSON.stringify(ledger, null, 2));

    // Rename temp file to final path (atomic on most filesystems)
    fs.renameSync(tempPath, ledgerPath);

    return { ok: true, value: undefined };
  } catch (error) {
    // Clean up temp file if it exists
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // Ignore cleanup errors
    }

    return {
      ok: false,
      error: `Failed to write ledger: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Initialize a new ledger with the given hunk IDs, all in pending state.
 * If ledger already exists with same diff/config hashes, returns existing ledger (idempotent).
 * If ledger exists with different hashes, returns error.
 */
export async function initializeLedger(
  hunkIds: string[],
  gitDiffHash: string,
  configHash: string,
  repoRoot: string,
): Promise<LedgerResult<HunkLedger>> {
  const existing = await readLedger(repoRoot);

  if (existing.ok) {
    // Check if hashes match
    if (existing.value.gitDiffHash !== gitDiffHash) {
      return {
        ok: false,
        error: `Ledger already exists with different diff hash: ${existing.value.gitDiffHash} vs ${gitDiffHash}`,
      };
    }

    // Idempotent - return existing ledger
    return existing;
  }

  // Create new ledger
  const hunks: HunkLedger["hunks"] = {};
  for (const hunkId of hunkIds) {
    hunks[hunkId] = {
      id: hunkId,
      file: "", // Will be populated when staging
      hunkIndex: 0,
      status: "pending",
      commitId: null,
    };
  }

  const ledger: HunkLedger = {
    gitDiffHash,
    configHash,
    hunks,
    newFiles: {},
    commits: {},
    ledgerVersion: 1,
  };

  const writeResult = await writeLedger(ledger, repoRoot);
  if (!writeResult.ok) {
    return writeResult;
  }

  return { ok: true, value: ledger };
}

/**
 * Move hunk IDs from pending to committed.
 * Returns new ledger object (immutable update).
 */
export function markCommitted(
  hunkIds: string[],
  ledger: HunkLedger,
  commitId: string,
): LedgerResult<HunkLedger> {
  // Check if all hunk IDs are pending
  const notPending = hunkIds.filter((id) => {
    const hunk = ledger.hunks[id];
    return !hunk || hunk.status !== "pending";
  });

  if (notPending.length > 0) {
    return {
      ok: false,
      error: `Hunk IDs not pending: ${notPending.join(", ")}`,
    };
  }

  // Create new ledger with updated statuses
  const newHunks = { ...ledger.hunks };
  for (const hunkId of hunkIds) {
    const hunk = newHunks[hunkId];
    if (hunk) {
      newHunks[hunkId] = {
        ...hunk,
        status: "committed",
        commitId,
      };
    }
  }

  return {
    ok: true,
    value: {
      ...ledger,
      hunks: newHunks,
    },
  };
}

/**
 * Move hunk IDs from committed back to pending.
 * Used for rollback.
 */
export function rollbackHunks(
  hunkIds: string[],
  ledger: HunkLedger,
): LedgerResult<HunkLedger> {
  // Check if all hunk IDs are committed
  const notCommitted = hunkIds.filter((id) => {
    const hunk = ledger.hunks[id];
    return !hunk || hunk.status !== "committed";
  });

  if (notCommitted.length > 0) {
    return {
      ok: false,
      error: `Hunk IDs not committed: ${notCommitted.join(", ")}`,
    };
  }

  // Create new ledger with updated statuses
  const newHunks = { ...ledger.hunks };
  for (const hunkId of hunkIds) {
    const hunk = newHunks[hunkId];
    if (hunk) {
      newHunks[hunkId] = {
        ...hunk,
        status: "pending",
        commitId: null,
      };
    }
  }

  return {
    ok: true,
    value: {
      ...ledger,
      hunks: newHunks,
    },
  };
}

/**
 * Return the subset of hunk IDs that are still pending.
 * Used to filter out already-committed hunks before execution.
 */
export async function verifyHunksPending(
  hunkIds: string[],
  ledger: HunkLedger,
): Promise<LedgerResult<string[]>> {
  const pending = hunkIds.filter((id) => {
    const hunk = ledger.hunks[id];
    return hunk && hunk.status === "pending";
  });

  return { ok: true, value: pending };
}

/**
 * Return all committed hunk IDs.
 * Used by resume logic.
 */
export function getCommittedHunks(ledger: HunkLedger): string[] {
  return Object.values(ledger.hunks)
    .filter((hunk) => hunk.status === "committed")
    .map((hunk) => hunk.id);
}
