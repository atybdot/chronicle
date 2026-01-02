import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { $ } from "bun";
import { mkdir, rm } from "fs/promises";
import { join } from "path";
import {
  isGitRepo,
  getGitStatus,
  getGitRoot,
  stageFiles,
  createCommit,
  getRecentCommits,
} from "../src/lib/git";

const TEST_DIR = join(import.meta.dir, ".test-repo");

describe("Git utilities", () => {
  beforeAll(async () => {
    // Create test directory and init git repo
    await mkdir(TEST_DIR, { recursive: true });
    await $`git init`.cwd(TEST_DIR).quiet();
    await $`git config user.email "test@test.com"`.cwd(TEST_DIR).quiet();
    await $`git config user.name "Test User"`.cwd(TEST_DIR).quiet();
  });

  afterAll(async () => {
    // Cleanup
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("isGitRepo returns true for git repos", async () => {
    const result = await isGitRepo(TEST_DIR);
    expect(result).toBe(true);
  });

  test("isGitRepo returns false for non-git directories", async () => {
    const result = await isGitRepo("/tmp");
    expect(result).toBe(false);
  });

  test("getGitRoot returns the repo root", async () => {
    const root = await getGitRoot(TEST_DIR);
    expect(root).toBe(TEST_DIR);
  });

  test("getGitStatus returns untracked files", async () => {
    // Create a test file
    await Bun.write(join(TEST_DIR, "test.txt"), "hello world");

    const status = await getGitStatus(TEST_DIR);

    expect(status.untracked).toContain("test.txt");
    expect(status.staged.length).toBe(0);
    expect(status.unstaged.length).toBe(0);
  });

  test("stageFiles stages files correctly", async () => {
    await stageFiles(["test.txt"], TEST_DIR);

    const status = await getGitStatus(TEST_DIR);

    expect(status.staged.length).toBe(1);
    expect(status.staged[0]?.path).toBe("test.txt");
    expect(status.untracked).not.toContain("test.txt");
  });

  test("createCommit creates a commit with custom date", async () => {
    const customDate = new Date("2024-01-15T10:00:00Z");

    await createCommit("test: initial commit", customDate, undefined, undefined, TEST_DIR);

    const commits = await getRecentCommits(1, TEST_DIR);

    expect(commits.length).toBe(1);
    expect(commits[0]?.message).toBe("test: initial commit");
    expect(commits[0]?.date.toISOString()).toBe(customDate.toISOString());
  });

  test("getGitStatus detects modified files", async () => {
    // Create a new file, stage and commit it
    const fileName = `modify-me-${Date.now()}.txt`;
    await Bun.write(join(TEST_DIR, fileName), "original content");
    await stageFiles([fileName], TEST_DIR);
    await createCommit(`test: add ${fileName}`, new Date(), undefined, undefined, TEST_DIR);

    // Now modify it
    await Bun.write(join(TEST_DIR, fileName), "modified content");

    const status = await getGitStatus(TEST_DIR);

    const modifiedFile = status.unstaged.find((f) => f.path === fileName);
    expect(modifiedFile).toBeDefined();
    expect(modifiedFile?.status).toBe("modified");
  });
});
