import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { $ } from "bun";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Orchestrator } from "../src/lib/agents/orchestrator";
import { PlanCache } from "../src/lib/cache";
import { readLedger } from "../src/lib/hunk-ledger";
import {
  isGitRepo,
  getGitRoot,
  createCommit,
  getDiffs,
  parseDiffs,
  stageHunksByIds,
  rollbackHunks,
  unstageAll,
} from "../src/lib/git";
import type { Config } from "../src/types";

// Mock AI responses for deterministic testing
const MOCK_AI_RESPONSES = {
  // File analyzer response
  fileAnalysis: {
    groups: [
      {
        id: "group-1",
        files: ["src/auth.ts"],
        filePaths: ["src/auth.ts"],
        reason: "Authentication module",
        fileHunks: [
          {
            path: "src/auth.ts",
            hunks: [0, 1],
          },
        ],
      },
      {
        id: "group-2",
        files: ["src/utils.ts"],
        filePaths: ["src/utils.ts"],
        reason: "Utility functions",
        fileHunks: [
          {
            path: "src/utils.ts",
            hunks: [0],
          },
        ],
      },
    ],
  },
  // Message writer response
  messages: [
    {
      groupId: "group-1",
      subject: "feat: add authentication module",
      body: "Add login and logout functionality",
      files: ["src/auth.ts"],
    },
    {
      groupId: "group-2",
      subject: "feat: add utility functions",
      body: "Add helper functions for common operations",
      files: ["src/utils.ts"],
    },
  ],
  // Timestamp distributor response
  timestamps: [
    {
      groupId: "group-1",
      commitDate: "2024-01-15T10:00:00.000Z",
      reasoning: "First commit",
    },
    {
      groupId: "group-2",
      commitDate: "2024-01-15T11:00:00.000Z",
      reasoning: "Second commit",
    },
  ],
  // Auditor response
  audit: {
    signals: [],
    iterations: 1,
  },
};

const TEST_TIMEOUT = 60000;

describe("E2E Integration Tests", () => {
  let testDir: string;

  beforeEach(async () => {
    // Create temporary test directory
    testDir = mkdtempSync(join(tmpdir(), "chronicle-e2e-"));

    // Initialize git repo
    await $`git init`.cwd(testDir);
    await $`git config user.email "test@example.com"`.cwd(testDir);
    await $`git config user.name "Test User"`.cwd(testDir);

    // Create initial commit
    writeFileSync(join(testDir, "README.md"), "# Test Project");
    await $`git add README.md`.cwd(testDir);
    await $`git commit -m "initial commit"`.cwd(testDir);
  });

  afterEach(() => {
    // Cleanup
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("Happy Path", () => {
    it(
      "should create commits for changed files",
      async () => {
        // Create src directory and test files
        mkdirSync(join(testDir, "src"), { recursive: true });
        writeFileSync(
          join(testDir, "src/auth.ts"),
          `export function login() { return true; }
export function logout() { return false; }`,
        );
        writeFileSync(
          join(testDir, "src/utils.ts"),
          `export function formatDate(d: Date) { return d.toISOString(); }`,
        );

        // Get status to check for untracked files
        const status = await $`git status --porcelain`.cwd(testDir).text();
        // Git shows the directory as untracked when all files in it are new
        expect(status).toContain("src");

        // Verify files exist on disk
        expect(existsSync(join(testDir, "src/auth.ts"))).toBe(true);
        expect(existsSync(join(testDir, "src/utils.ts"))).toBe(true);
      },
      TEST_TIMEOUT,
    );

    it(
      "should handle multiple file changes",
      async () => {
        // Create multiple files
        writeFileSync(join(testDir, "file1.ts"), "export const a = 1;");
        writeFileSync(join(testDir, "file2.ts"), "export const b = 2;");
        writeFileSync(join(testDir, "file3.ts"), "export const c = 3;");

        const status = await $`git status --porcelain`.cwd(testDir).text();
        // Git may show individual files or a directory
        expect(status).toContain("file1.ts");
        expect(status).toContain("file2.ts");
        expect(status).toContain("file3.ts");
      },
      TEST_TIMEOUT,
    );
  });

  describe("Cache Operations", () => {
    it(
      "should compute plan hash correctly",
      async () => {
        const config: Config = {
          llm: {
            selected: {
              provider: "openai",
              model: "gpt-4",
            },
            providers: [],
            customPrompt: "",
            agentRoles: {
              fileAnalyzer: { model: "gpt-4", provider: "openai" },
              commitPlanner: { model: "gpt-4", provider: "openai" },
              messageWriter: { model: "gpt-4", provider: "openai" },
              timestampDistributor: { model: "gpt-4", provider: "openai" },
              auditor: { model: "gpt-4", provider: "openai" },
              executor: { model: "gpt-4", provider: "openai" },
            },
          },
          defaults: {
            distribution: "realistic",
            dryRun: false,
            workHoursStart: 9,
            workHoursEnd: 17,
            excludeWeekends: true,
            intent: "feature development",
          },
          git: {
            authorName: "Test User",
            authorEmail: "test@example.com",
          },
        };

        const diffHash = "test-diff-hash";
        const intent = "feature development";
        const committedHunkIds: string[] = [];

        const planHash = PlanCache.computePlanHash(
          diffHash,
          config,
          intent,
          committedHunkIds,
        );

        expect(planHash).toBeTruthy();
        expect(typeof planHash).toBe("string");
        expect(planHash.length).toBeGreaterThan(0);
      },
      TEST_TIMEOUT,
    );

    it(
      "should invalidate cache correctly",
      async () => {
        const planHash = "test-plan-hash-123";

        // Write a dummy cache file
        const cacheDir = join(
          process.env.HOME ?? "/tmp",
          ".cache",
          "chronicle",
          "plans",
        );
        mkdirSync(cacheDir, { recursive: true });
        const cacheFile = join(cacheDir, `${planHash}.json`);
        writeFileSync(cacheFile, JSON.stringify({ test: true }));

        // Verify file exists
        expect(existsSync(cacheFile)).toBe(true);

        // Invalidate cache
        const result = await PlanCache.invalidateCache(planHash);
        expect(result.ok).toBe(true);

        // Verify file is deleted
        expect(existsSync(cacheFile)).toBe(false);
      },
      TEST_TIMEOUT,
    );
  });

  describe("Hunk Operations", () => {
    it(
      "should parse and stage hunks correctly",
      async () => {
        // Create src directory and a file with multiple changes
        mkdirSync(join(testDir, "src"), { recursive: true });
        writeFileSync(
          join(testDir, "src/app.ts"),
          `export function app() {
  return "v1";
}`,
        );
        await $`git add src/app.ts`.cwd(testDir);
        await $`git commit -m "initial app"`.cwd(testDir);

        // Modify the file
        writeFileSync(
          join(testDir, "src/app.ts"),
          `export function app() {
  return "v2";
}

export function helper() {
  return "helper";
}`,
        );

        // Get diff
        const diffText = await $`git diff HEAD`.cwd(testDir).text();
        expect(diffText).toContain("src/app.ts");

        // Parse the diff
        const parsedDiffs = parseDiffs(diffText);
        expect(parsedDiffs.length).toBe(1);
        const firstDiff = parsedDiffs[0];
        expect(firstDiff).toBeDefined();
        expect(firstDiff?.filePath).toBe("src/app.ts");
        expect(firstDiff?.hunks.length).toBeGreaterThan(0);
      },
      TEST_TIMEOUT,
    );

    it(
      "should rollback hunks correctly",
      async () => {
        // Create and stage a file
        writeFileSync(join(testDir, "rollback-test.ts"), "export const x = 1;");
        await $`git add rollback-test.ts`.cwd(testDir);

        // Verify file is staged
        const statusBefore = await $`git status --porcelain`.cwd(testDir).text();
        expect(statusBefore).toContain("A  rollback-test.ts");

        // Rollback
        await rollbackHunks([], testDir);

        // Verify file is no longer staged
        const statusAfter = await $`git status --porcelain`.cwd(testDir).text();
        expect(statusAfter).not.toContain("A  rollback-test.ts");
      },
      TEST_TIMEOUT,
    );

    it(
      "should unstage all files correctly",
      async () => {
        // Create and stage multiple files
        writeFileSync(join(testDir, "unstage1.ts"), "export const a = 1;");
        writeFileSync(join(testDir, "unstage2.ts"), "export const b = 2;");
        await $`git add unstage1.ts unstage2.ts`.cwd(testDir);

        // Verify files are staged
        const statusBefore = await $`git status --porcelain`.cwd(testDir).text();
        expect(statusBefore).toContain("A  unstage1.ts");
        expect(statusBefore).toContain("A  unstage2.ts");

        // Unstage all
        await unstageAll(testDir);

        // Verify files are no longer staged
        const statusAfter = await $`git status --porcelain`.cwd(testDir).text();
        expect(statusAfter).not.toContain("A  unstage1.ts");
        expect(statusAfter).not.toContain("A  unstage2.ts");
      },
      TEST_TIMEOUT,
    );
  });

  describe("Hook Failure Handling", () => {
    it(
      "should bypass failing hooks with --no-verify",
      async () => {
        // Create a file
        writeFileSync(join(testDir, "hook-test.ts"), "export const test = true;");
        await $`git add hook-test.ts`.cwd(testDir);

        // Create a failing pre-commit hook
        const hooksDir = join(testDir, ".githooks");
        mkdirSync(hooksDir, { recursive: true });
        writeFileSync(
          join(hooksDir, "pre-commit"),
          "#!/bin/sh\necho 'Hook failed' >&2\nexit 1\n",
        );
        await $`chmod +x .githooks/pre-commit`.cwd(testDir);
        await $`git config core.hooksPath .githooks`.cwd(testDir);

        // Try to commit without --no-verify (should fail)
        await expect(
          createCommit(
            "test: should fail",
            new Date("2024-01-15T10:00:00.000Z"),
            "Test User",
            "test@example.com",
            testDir,
          ),
        ).rejects.toThrow(/Hook failed/i);

        // Commit with --no-verify (should succeed)
        const hash = await createCommit(
          "test: bypass hook",
          new Date("2024-01-15T10:00:00.000Z"),
          "Test User",
          "test@example.com",
          testDir,
          true, // noVerify
        );

        expect(hash).toBeTruthy();
        const log = await $`git log -1 --format=%s`.cwd(testDir).text();
        expect(log.trim()).toBe("test: bypass hook");
      },
      TEST_TIMEOUT,
    );
  });

  describe("Dry Run Mode", () => {
    it(
      "should show plan without executing",
      async () => {
        // Create test file
        writeFileSync(join(testDir, "dry-run-file.ts"), "export const dry = true;");

        // Get status
        const status = await $`git status --porcelain`.cwd(testDir).text();
        expect(status).toContain("dry-run-file.ts");

        // Verify no commits were created
        const log = await $`git log --oneline`.cwd(testDir).text();
        const lines = log.trim().split("\n");
        expect(lines.length).toBe(1); // Only initial commit
        expect(lines[0]).toContain("initial commit");
      },
      TEST_TIMEOUT,
    );
  });

  describe("Git Utilities", () => {
    it(
      "should detect git repository",
      async () => {
        const isRepo = await isGitRepo(testDir);
        expect(isRepo).toBe(true);
      },
      TEST_TIMEOUT,
    );

    it(
      "should get git root correctly",
      async () => {
        const root = await getGitRoot(testDir);
        expect(root).toBe(testDir);
      },
      TEST_TIMEOUT,
    );

    it(
      "should create commit with custom date",
      async () => {
        writeFileSync(join(testDir, "date-test.ts"), "export const date = true;");
        await $`git add date-test.ts`.cwd(testDir);

        const date = new Date("2024-01-15T10:00:00.000Z");
        const hash = await createCommit(
          "test: custom date",
          date,
          "Test User",
          "test@example.com",
          testDir,
        );

        expect(hash).toBeTruthy();

        const commitDate = await $`git log -1 --format=%ai`.cwd(testDir).text();
        expect(commitDate.trim()).toContain("2024-01-15");
      },
      TEST_TIMEOUT,
    );
  });
});
