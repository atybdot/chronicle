import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { readLedger, writeLedger, initializeLedger, markCommitted, rollbackHunks, verifyHunksPending, getCommittedHunks } from "../src/lib/hunk-ledger";
import type { HunkLedger } from "../src/types";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hunk-ledger-test-"));
}

function removeTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe("Hunk Ledger", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  describe("readLedger", () => {
    it("should return not_found for repos without a ledger", async () => {
      const result = await readLedger(tempDir);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("not_found");
      }
    });

    it("should read an existing ledger", async () => {
      const ledger: HunkLedger = {
        gitDiffHash: "diff-hash-1",
        configHash: "config-hash-1",
        hunks: {},
        newFiles: {},
        commits: {},
        ledgerVersion: 1,
      };

      await writeLedger(ledger, tempDir);
      const result = await readLedger(tempDir);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.gitDiffHash).toBe("diff-hash-1");
        expect(result.value.configHash).toBe("config-hash-1");
      }
    });
  });

  describe("writeLedger", () => {
    it("should create .chronicle directory if it doesn't exist", async () => {
      const ledger: HunkLedger = {
        gitDiffHash: "diff-hash-1",
        configHash: "config-hash-1",
        hunks: {},
        newFiles: {},
        commits: {},
        ledgerVersion: 1,
      };

      const result = await writeLedger(ledger, tempDir);
      expect(result.ok).toBe(true);

      const chronicleDir = path.join(tempDir, ".chronicle");
      expect(fs.existsSync(chronicleDir)).toBe(true);
    });

    it("should write ledger atomically", async () => {
      const ledger: HunkLedger = {
        gitDiffHash: "diff-hash-1",
        configHash: "config-hash-1",
        hunks: {},
        newFiles: {},
        commits: {},
        ledgerVersion: 1,
      };

      await writeLedger(ledger, tempDir);

      // Verify file exists and is valid JSON
      const ledgerPath = path.join(tempDir, ".chronicle", "hunk-ledger.json");
      expect(fs.existsSync(ledgerPath)).toBe(true);

      const content = fs.readFileSync(ledgerPath, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.gitDiffHash).toBe("diff-hash-1");
    });
  });

  describe("initializeLedger", () => {
    it("should create a new ledger with pending hunks", async () => {
      const hunkIds = ["hunk-1", "hunk-2", "hunk-3"];
      const result = await initializeLedger(hunkIds, "diff-hash-1", "config-hash-1", tempDir);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.hunks["hunk-1"]?.status).toBe("pending");
        expect(result.value.hunks["hunk-2"]?.status).toBe("pending");
        expect(result.value.hunks["hunk-3"]?.status).toBe("pending");
        expect(result.value.gitDiffHash).toBe("diff-hash-1");
        expect(result.value.configHash).toBe("config-hash-1");
      }
    });

    it("should be idempotent - calling twice returns same ledger", async () => {
      const hunkIds = ["hunk-1", "hunk-2"];
      const result1 = await initializeLedger(hunkIds, "diff-hash-1", "config-hash-1", tempDir);
      const result2 = await initializeLedger(hunkIds, "diff-hash-1", "config-hash-1", tempDir);

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);

      if (result1.ok && result2.ok) {
        expect(result2.value.hunks).toEqual(result1.value.hunks);
      }
    });

    it("should not overwrite existing ledger with different diff hash", async () => {
      const hunkIds = ["hunk-1"];
      await initializeLedger(hunkIds, "diff-hash-1", "config-hash-1", tempDir);

      const result = await initializeLedger(hunkIds, "diff-hash-2", "config-hash-1", tempDir);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("already exists");
      }
    });
  });

  describe("markCommitted", () => {
    it("should move hunks from pending to committed", async () => {
      const ledger: HunkLedger = {
        gitDiffHash: "diff-hash-1",
        configHash: "config-hash-1",
        hunks: {
          "hunk-1": { id: "hunk-1", file: "src/a.ts", hunkIndex: 0, status: "pending", commitId: null },
          "hunk-2": { id: "hunk-2", file: "src/b.ts", hunkIndex: 0, status: "pending", commitId: null },
        },
        newFiles: {},
        commits: {},
        ledgerVersion: 1,
      };

      const result = markCommitted(["hunk-1"], ledger, "commit-1");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.hunks["hunk-1"]?.status).toBe("committed");
        expect(result.value.hunks["hunk-1"]?.commitId).toBe("commit-1");
        expect(result.value.hunks["hunk-2"]?.status).toBe("pending");
      }
    });

    it("should return error if hunk IDs are not in pending state", async () => {
      const ledger: HunkLedger = {
        gitDiffHash: "diff-hash-1",
        configHash: "config-hash-1",
        hunks: {
          "hunk-1": { id: "hunk-1", file: "src/a.ts", hunkIndex: 0, status: "committed", commitId: "commit-1" },
        },
        newFiles: {},
        commits: {},
        ledgerVersion: 1,
      };

      const result = markCommitted(["hunk-1"], ledger, "commit-2");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("not pending");
      }
    });
  });

  describe("rollbackHunks", () => {
    it("should move hunks from committed back to pending", async () => {
      const ledger: HunkLedger = {
        gitDiffHash: "diff-hash-1",
        configHash: "config-hash-1",
        hunks: {
          "hunk-1": { id: "hunk-1", file: "src/a.ts", hunkIndex: 0, status: "committed", commitId: "commit-1" },
          "hunk-2": { id: "hunk-2", file: "src/b.ts", hunkIndex: 0, status: "committed", commitId: "commit-1" },
        },
        newFiles: {},
        commits: {},
        ledgerVersion: 1,
      };

      const result = rollbackHunks(["hunk-1"], ledger);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.hunks["hunk-1"]?.status).toBe("pending");
        expect(result.value.hunks["hunk-1"]?.commitId).toBeNull();
        expect(result.value.hunks["hunk-2"]?.status).toBe("committed");
      }
    });

    it("should return error if hunk IDs are not committed", async () => {
      const ledger: HunkLedger = {
        gitDiffHash: "diff-hash-1",
        configHash: "config-hash-1",
        hunks: {
          "hunk-1": { id: "hunk-1", file: "src/a.ts", hunkIndex: 0, status: "pending", commitId: null },
        },
        newFiles: {},
        commits: {},
        ledgerVersion: 1,
      };

      const result = rollbackHunks(["hunk-1"], ledger);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("not committed");
      }
    });
  });

  describe("verifyHunksPending", () => {
    it("should return subset of hunk IDs that are still pending", async () => {
      const ledger: HunkLedger = {
        gitDiffHash: "diff-hash-1",
        configHash: "config-hash-1",
        hunks: {
          "hunk-1": { id: "hunk-1", file: "src/a.ts", hunkIndex: 0, status: "pending", commitId: null },
          "hunk-2": { id: "hunk-2", file: "src/b.ts", hunkIndex: 0, status: "committed", commitId: "commit-1" },
          "hunk-3": { id: "hunk-3", file: "src/c.ts", hunkIndex: 0, status: "pending", commitId: null },
        },
        newFiles: {},
        commits: {},
        ledgerVersion: 1,
      };

      const result = await verifyHunksPending(["hunk-1", "hunk-2", "hunk-3"], ledger);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(["hunk-1", "hunk-3"]);
      }
    });
  });

  describe("getCommittedHunks", () => {
    it("should return all committed hunk IDs", () => {
      const ledger: HunkLedger = {
        gitDiffHash: "diff-hash-1",
        configHash: "config-hash-1",
        hunks: {
          "hunk-1": { id: "hunk-1", file: "src/a.ts", hunkIndex: 0, status: "committed", commitId: "commit-1" },
          "hunk-2": { id: "hunk-2", file: "src/b.ts", hunkIndex: 0, status: "pending", commitId: null },
          "hunk-3": { id: "hunk-3", file: "src/c.ts", hunkIndex: 0, status: "committed", commitId: "commit-2" },
        },
        newFiles: {},
        commits: {},
        ledgerVersion: 1,
      };

      const result = getCommittedHunks(ledger);

      expect(result).toEqual(["hunk-1", "hunk-3"]);
    });
  });

  describe("round-trip", () => {
    it("should write and read back the same ledger", async () => {
      const ledger: HunkLedger = {
        gitDiffHash: "diff-hash-1",
        configHash: "config-hash-1",
        hunks: {
          "hunk-1": { id: "hunk-1", file: "src/a.ts", hunkIndex: 0, status: "pending", commitId: null },
        },
        newFiles: {
          "src/new.ts": { path: "src/new.ts", status: "pending", commitId: null },
        },
        commits: {
          "commit-1": { message: "feat: add new", hash: null, applied: false },
        },
        ledgerVersion: 1,
      };

      await writeLedger(ledger, tempDir);
      const result = await readLedger(tempDir);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.gitDiffHash).toBe(ledger.gitDiffHash);
        expect(result.value.configHash).toBe(ledger.configHash);
        expect(result.value.hunks).toEqual(ledger.hunks);
        expect(result.value.newFiles).toEqual(ledger.newFiles);
        expect(result.value.commits).toEqual(ledger.commits);
      }
    });
  });
});
