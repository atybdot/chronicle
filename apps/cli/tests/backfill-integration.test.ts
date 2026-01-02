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
});
