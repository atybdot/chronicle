import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { $ } from "bun";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  isGitRepo,
  getGitStatus,
  createCommit,
} from "../src/lib/git";
import { __internal as backfillInternal } from "../src/commands/backfill";

const TEST_TIMEOUT = 30000;

describe("Backfill Integration", () => {
  let testDir: string;

  beforeEach(async () => {
    // Create temporary test directory
    testDir = mkdtempSync(join(tmpdir(), "chronicle-test-"));
    
    // Initialize git repo
    await $`git init`.cwd(testDir);
    await $`git config user.email "test@example.com"`.cwd(testDir);
    await $`git config user.name "Test User"`.cwd(testDir);
  });

  afterEach(() => {
    // Cleanup
    rmSync(testDir, { recursive: true, force: true });
  });

  it(
    "should suggest at least one day per analyzable file when grouping stays atomic",
    async () => {
      expect(
        backfillInternal.getMinimumSuggestedTimelineDays([
          {
            fileHunks: [{ path: "src/a.ts" }, { path: "src/b.ts" }],
          },
          {
            fileHunks: [{ path: "src/c.ts" }],
          },
        ] as Array<{ fileHunks: Array<{ path: string }> }>),
      ).toBe(3);
    },
    TEST_TIMEOUT,
  );

  it(
    "should detect git repository",
    async () => {
      const isRepo = await isGitRepo(testDir);
      expect(isRepo).toBe(true);
    },
    TEST_TIMEOUT,
  );

  it(
    "should get git status with untracked files",
    async () => {
      // Create test files
      writeFileSync(join(testDir, "README.md"), "# Test");
      writeFileSync(join(testDir, ".gitignore"), "node_modules/");

      const status = await getGitStatus(testDir);

      expect(status.untracked).toContain("README.md");
      expect(status.untracked).toContain(".gitignore");
      expect(status.staged).toHaveLength(0);
      expect(status.unstaged).toHaveLength(0);
    },
    TEST_TIMEOUT,
  );

  it(
    "should create commit with custom date",
    async () => {
      // Create and stage a file
      writeFileSync(join(testDir, "test.txt"), "Hello World");
      await $`git add test.txt`.cwd(testDir);

      // Create commit with past date
      const pastDate = new Date("2024-01-15T10:30:00.000Z");
      const hash = await createCommit(
        "test: initial commit",
        pastDate,
        "Test Author",
        "test@example.com",
        testDir,
      );

      expect(hash).toBeTruthy();
      expect(hash.length).toBeGreaterThan(0);

      // Verify commit date
      const commitDate = await $`git log -1 --format=%ai`.cwd(testDir).text();
      expect(commitDate.trim()).toContain("2024-01-15");
    },
    TEST_TIMEOUT,
  );

  it(
    "should apply provided author identity to author and committer",
    async () => {
      writeFileSync(join(testDir, "identity.txt"), "identity");
      await $`git add identity.txt`.cwd(testDir);

      await createCommit(
        "chore: set explicit identity",
        new Date("2024-01-16T09:00:00.000Z"),
        "Backfill Author",
        "backfill@example.com",
        testDir,
      );

      const identity = await $`git log -1 --format=%an%x00%ae%x00%cn%x00%ce`.cwd(testDir).text();
      expect(identity.trim()).toBe("Backfill Author\0backfill@example.com\0Backfill Author\0backfill@example.com");
    },
    TEST_TIMEOUT,
  );

  it(
    "should include git output when commit creation fails",
    async () => {
      await expect(
        createCommit(
          "chore: fail without staged changes",
          new Date("2024-01-17T09:00:00.000Z"),
          "Backfill Author",
          "backfill@example.com",
          testDir,
        ),
      ).rejects.toThrow(/git commit failed[\s\S]*(nothing to commit|nothing added to commit|no changes added to commit)/i);
    },
    TEST_TIMEOUT,
  );

  it(
    "should support creating commits with --no-verify",
    async () => {
      writeFileSync(join(testDir, "hooked.txt"), "Hello Hook");
      await $`git add hooked.txt`.cwd(testDir);

      const hooksDir = join(testDir, ".githooks");
      mkdirSync(hooksDir, { recursive: true });
      writeFileSync(join(hooksDir, "pre-commit"), "#!/bin/sh\necho 'lint-staged failed: oxfmt --write' >&2\nexit 1\n");
      await $`chmod +x .githooks/pre-commit`.cwd(testDir);
      await $`git config core.hooksPath .githooks`.cwd(testDir);

      await expect(
        createCommit(
          "chore: commit with failing hook",
          new Date("2024-01-18T09:00:00.000Z"),
          "Backfill Author",
          "backfill@example.com",
          testDir,
        ),
      ).rejects.toThrow(/lint-staged failed: oxfmt --write/i);

      const hash = await createCommit(
        "chore: bypass failing hook",
        new Date("2024-01-18T09:05:00.000Z"),
        "Backfill Author",
        "backfill@example.com",
        testDir,
        true,
      );

      expect(hash).toBeTruthy();
      const log = await $`git log -1 --format=%s`.cwd(testDir).text();
      expect(log.trim()).toBe("chore: bypass failing hook");
    },
    TEST_TIMEOUT,
  );

  it(
    "should create multiple commits with different dates",
    async () => {
      // Create first commit
      writeFileSync(join(testDir, "file1.txt"), "Content 1");
      await $`git add file1.txt`.cwd(testDir);
      const date1 = new Date("2024-01-10T09:00:00.000Z");
      await createCommit(
        "feat: add feature 1",
        date1,
        "Test Author",
        "test@example.com",
        testDir,
      );

      // Create second commit
      writeFileSync(join(testDir, "file2.txt"), "Content 2");
      await $`git add file2.txt`.cwd(testDir);
      const date2 = new Date("2024-01-12T14:30:00.000Z");
      await createCommit(
        "feat: add feature 2",
        date2,
        "Test Author",
        "test@example.com",
        testDir,
      );

      // Create third commit
      writeFileSync(join(testDir, "file3.txt"), "Content 3");
      await $`git add file3.txt`.cwd(testDir);
      const date3 = new Date("2024-01-15T16:45:00.000Z");
      await createCommit(
        "fix: bug fix",
        date3,
        "Test Author",
        "test@example.com",
        testDir,
      );

      // Verify all commits exist
      const log = await $`git log --oneline`.cwd(testDir).text();
      const lines = log.trim().split("\n");
      expect(lines).toHaveLength(3);

      // Verify dates are in correct order (newest first)
      const dates = await $`git log --format=%ai`.cwd(testDir).text();
      const dateLines = dates.trim().split("\n");
      expect(dateLines[0]).toContain("2024-01-15");
      expect(dateLines[1]).toContain("2024-01-12");
      expect(dateLines[2]).toContain("2024-01-10");
    },
    TEST_TIMEOUT,
  );

  it(
    "should handle empty repository without commits",
    async () => {
      // Try to get status on empty repo
      const status = await getGitStatus(testDir);
      expect(status.untracked).toHaveLength(0);
      expect(status.staged).toHaveLength(0);
      expect(status.unstaged).toHaveLength(0);

      // Verify no commits exist
      try {
        await $`git log -1`.cwd(testDir);
        expect(false).toBe(true); // Should not reach here
      } catch {
        // Expected to fail
        expect(true).toBe(true);
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "should work with nested directories",
    async () => {
      // Create nested structure
      mkdirSync(join(testDir, "src", "components"), { recursive: true });
      writeFileSync(join(testDir, "src", "index.ts"), "export {}");
      writeFileSync(join(testDir, "src", "components", "Button.ts"), "export class Button {}");

      const status = await getGitStatus(testDir);
      // Git status returns directory entries with trailing slash for untracked dirs
      expect(status.untracked.some((f: string) => f.startsWith("src/"))).toBe(true);
    },
    TEST_TIMEOUT,
  );

  it(
    "should create deterministic fallback commits for remaining files",
    async () => {
      writeFileSync(join(testDir, "leftover-a.txt"), "A\n");
      writeFileSync(join(testDir, "leftover-b.txt"), "B\n");

      const result = await backfillInternal.createFallbackCommitsForRemainingChanges({
        cwd: testDir,
        commitAuthorName: "Backfill Author",
        commitAuthorEmail: "backfill@example.com",
        noVerify: false,
        startDate: new Date("2024-01-20T09:00:00.000Z"),
      });

      expect(result.error).toBeUndefined();
      expect(result.created).toBe(2);
      expect(result.messages).toEqual([
        "chore: include remaining changes in leftover-a.txt",
        "chore: include remaining changes in leftover-b.txt",
      ]);
      expect(result.remainingFiles).toHaveLength(0);

      const log = await $`git log --format=%s`.cwd(testDir).text();
      expect(log.trim().split("\n")).toEqual([
        "chore: include remaining changes in leftover-b.txt",
        "chore: include remaining changes in leftover-a.txt",
      ]);
    },
    TEST_TIMEOUT,
  );

  it(
    "should avoid sending binary assets into analyzable AI groups",
    async () => {
      const { analyzeChangesSafe } = await import("../src/lib/ai");

      const files = [
        { path: "src/button.ts", status: "modified" as const },
        { path: "public/logo.png", status: "added" as const },
      ];
      const diffs = new Map<string, string>([
        [
          "src/button.ts",
          "diff --git a/src/button.ts b/src/button.ts\n@@ -1 +1 @@\n-export const label = 'old';\n+export const label = 'new';",
        ],
      ]);
      const untrackedContent = new Map<string, string>();
      const untrackedBytes = new Map<string, Uint8Array>([
        ["public/logo.png", Uint8Array.from([137, 80, 78, 71, 0, 1, 2])],
      ]);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        throw new Error("network blocked in test");
      }) as unknown as typeof fetch;

      try {
        const result = await analyzeChangesSafe(files, diffs, untrackedContent, untrackedBytes);
        if (result.isOk()) {
          expect(result.value.groups.some((group) => group.files.includes("public/logo.png"))).toBe(true);
          const aiDrivenGroups = result.value.groups.filter((group) => group.fileHunks.length > 0);
          expect(aiDrivenGroups.every((group) => !group.files.includes("public/logo.png"))).toBe(true);
        } else {
          expect(String(result.error.message)).not.toContain("public/logo.png");
        }
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
    TEST_TIMEOUT,
  );
});
