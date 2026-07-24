import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Executor } from "../src/lib/agents/executor";
import type { CommitGroup, HunkLedger } from "../src/types";
import { $ } from "bun";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "executor-test-"));
  await $`git init`.cwd(tempDir);
  await $`git config user.email "test@test.com"`.cwd(tempDir);
  await $`git config user.name "Test User"`.cwd(tempDir);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function createGroup(overrides: Partial<CommitGroup> = {}): CommitGroup {
  return {
    id: "group-1",
    name: "Add user authentication",
    description: "Implements login and signup functionality",
    hunkIds: ["hunk-1", "hunk-2"],
    filePaths: ["src/auth.ts", "src/auth.test.ts"],
    category: "feature",
    order: 0,
    dependencies: [],
    ...overrides,
  };
}

function createLedger(overrides: Partial<HunkLedger> = {}): HunkLedger {
  return {
    gitDiffHash: "abc123",
    configHash: "def456",
    hunks: {
      "hunk-1": {
        id: "hunk-1",
        file: "src/auth.ts",
        hunkIndex: 0,
        status: "pending",
        commitId: null,
      },
      "hunk-2": {
        id: "hunk-2",
        file: "src/auth.ts",
        hunkIndex: 1,
        status: "pending",
        commitId: null,
      },
      "hunk-3": {
        id: "hunk-3",
        file: "src/utils.ts",
        hunkIndex: 0,
        status: "pending",
        commitId: null,
      },
    },
    newFiles: {},
    commits: {},
    ledgerVersion: 1,
    ...overrides,
  };
}

describe("Executor", () => {
  describe("createBackupBranch", () => {
    test("creates backup branch with timestamp", async () => {
      await $`echo "initial" > file.txt`.cwd(tempDir);
      await $`git add .`.cwd(tempDir);
      await $`git commit -m "initial"`.cwd(tempDir);

      const result = await Executor.createBackupBranch(tempDir);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toMatch(/^chronicle-backup-\d+$/);
      }
    });

    test("returns error when no commits exist", async () => {
      const result = await Executor.createBackupBranch(tempDir);

      expect(result.ok).toBe(false);
    });
  });

  describe("verifyHunksPending", () => {
    test("returns ok when hunks are pending", async () => {
      const ledger = createLedger();

      const result = await Executor.verifyHunksPending({
        hunkIds: ["hunk-1", "hunk-2"],
        ledger,
      });

      expect(result.ok).toBe(true);
    });

    test("returns error when hunks are already committed", async () => {
      const ledger = createLedger({
        hunks: {
          "hunk-1": {
            id: "hunk-1",
            file: "src/auth.ts",
            hunkIndex: 0,
            status: "committed",
            commitId: "commit-1",
          },
        },
      });

      const result = await Executor.verifyHunksPending({
        hunkIds: ["hunk-1"],
        ledger,
      });

      expect(result.ok).toBe(false);
    });

    test("returns error when hunk IDs don't exist", async () => {
      const ledger = createLedger();

      const result = await Executor.verifyHunksPending({
        hunkIds: ["nonexistent"],
        ledger,
      });

      expect(result.ok).toBe(false);
    });
  });

  describe("stageHunks", () => {
    test("stages hunks successfully", async () => {
      await $`mkdir -p src`.cwd(tempDir);
      await $`echo "line1" > src/auth.ts`.cwd(tempDir);
      await $`git add .`.cwd(tempDir);
      await $`git commit -m "initial"`.cwd(tempDir);

      await $`echo "line2" >> src/auth.ts`.cwd(tempDir);

      // Get the diff and compute hunk ID
      const diffText = await $`git diff`.cwd(tempDir).text();
      const { parseDiffs, computeHunkId } = await import("../src/lib/git");
      const diffs = parseDiffs(diffText);
      
      // Compute the actual hunk ID from the diff content
      const hunkId = diffs[0]?.hunks[0] 
        ? computeHunkId(diffs[0].hunks[0].header + "\n" + diffs[0].hunks[0].content)
        : "unknown";

      const result = await Executor.stageHunks({
        hunkIds: [hunkId],
        diffs,
        repoRoot: tempDir,
      });

      expect(result.ok).toBe(true);
    });
  });

  describe("stageFullFile", () => {
    test("stages full file successfully", async () => {
      await $`mkdir -p src`.cwd(tempDir);
      await $`echo "line1" > src/auth.ts`.cwd(tempDir);
      await $`git add .`.cwd(tempDir);
      await $`git commit -m "initial"`.cwd(tempDir);

      await $`echo "line2" >> src/auth.ts`.cwd(tempDir);

      const result = await Executor.stageFullFile({
        filePath: "src/auth.ts",
        repoRoot: tempDir,
      });

      expect(result.ok).toBe(true);
    });
  });

  describe("unstageAll", () => {
    test("unstages all files", async () => {
      await $`mkdir -p src`.cwd(tempDir);
      await $`echo "line1" > src/auth.ts`.cwd(tempDir);
      await $`git add .`.cwd(tempDir);

      const result = await Executor.unstageAll(tempDir);

      expect(result.ok).toBe(true);
    });
  });

  describe("markGroupFailed", () => {
    test("marks group as failed in ledger", async () => {
      const ledger = createLedger();

      const result = await Executor.markGroupFailed({
        groupId: "group-1",
        ledger,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.commits["group-1"]).toBeTruthy();
        expect(result.value.commits["group-1"]?.applied).toBe(false);
      }
    });
  });

  describe("rollback", () => {
    test("resets to backup branch", async () => {
      await $`echo "initial" > file.txt`.cwd(tempDir);
      await $`git add .`.cwd(tempDir);
      await $`git commit -m "initial"`.cwd(tempDir);

      const backupResult = await Executor.createBackupBranch(tempDir);
      expect(backupResult.ok).toBe(true);

      await $`echo "change1" > file2.txt`.cwd(tempDir);
      await $`git add .`.cwd(tempDir);
      await $`git commit -m "change1"`.cwd(tempDir);

      const result = await Executor.rollback({
        backupBranch: backupResult.ok ? backupResult.value : "",
        ledger: createLedger(),
        repoRoot: tempDir,
      });

      expect(result.ok).toBe(true);
    });
  });

  describe("executeGroup", () => {
    test("returns error when no hunks to stage", async () => {
      const ledger = createLedger();
      const group = createGroup({ hunkIds: [] });

      const result = await Executor.executeGroup({
        group,
        ledger,
        diffs: [],
        date: new Date().toISOString(),
        repoRoot: tempDir,
      });

      expect(result.ok).toBe(false);
    });
  });
});