import { describe, expect, test, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { $ } from "bun";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import {
  isGitRepo,
  getGitStatus,
  getGitRoot,
  stageFiles,
  createCommit,
  getRecentCommits,
  isGitHookError,
  computeHunkId,
  parseDiffs,
  resolveHunkIdToPatch,
  stageHunksByIds,
  stageFullFile,
  unstageAll,
  createCommitWithDate,
  rollbackHunks,
  getDiffs,
} from "../src/lib/git";
import type { FileDiff } from "../src/lib/git";

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

  test("isGitHookError detects common git hook failures", () => {
    expect(isGitHookError("husky - pre-commit script failed (code 1)")).toBe(true);
    expect(isGitHookError("lint-staged failed because oxfmt --write received no target")).toBe(true);
    expect(isGitHookError("commit-msg hook declined")).toBe(true);
    expect(isGitHookError("nothing to commit, working tree clean")).toBe(false);
  });
});

describe("computeHunkId", () => {
  test("same content produces same hunk ID", () => {
    const content = "@@ -1,3 +1,3 @@\n-old\n+new\n context\n";
    const id1 = computeHunkId(content);
    const id2 = computeHunkId(content);
    expect(id1).toBe(id2);
  });

  test("different content produces different hunk IDs", () => {
    const id1 = computeHunkId("@@ -1,3 +1,3 @@\n-old\n+new1\n");
    const id2 = computeHunkId("@@ -1,3 +1,3 @@\n-old\n+new2\n");
    expect(id1).not.toBe(id2);
  });

  test("hunk ID is a valid SHA-256 hex string", () => {
    const id = computeHunkId("test content");
    expect(id).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("parseDiffs", () => {
  test("parses single file diff with one hunk", () => {
    const diffText = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,3 @@
 line1
-old
+new
 line3`;

    const files = parseDiffs(diffText);
    expect(files.length).toBe(1);
    expect(files[0]?.filePath).toBe("src/a.ts");
    expect(files[0]?.status).toBe("modified");
    expect(files[0]?.hunks.length).toBe(1);
    expect(files[0]?.hunks[0]?.header).toContain("@@ -1,3 +1,3 @@");
  });

  test("parses multiple file diffs", () => {
    const diffText = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-old
+new
diff --git a/src/b.ts b/src/b.ts
--- a/src/b.ts
+++ b/src/b.ts
@@ -1 +1 @@
-old
+new`;

    const files = parseDiffs(diffText);
    expect(files.length).toBe(2);
    expect(files[0]?.filePath).toBe("src/a.ts");
    expect(files[1]?.filePath).toBe("src/b.ts");
  });

  test("detects added files", () => {
    const diffText = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1 @@
+content`;

    const files = parseDiffs(diffText);
    expect(files.length).toBe(1);
    expect(files[0]?.status).toBe("added");
  });

  test("detects deleted files", () => {
    const diffText = `diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
--- a/src/old.ts
+++ /dev/null
@@ -1 +0,0 @@
-content`;

    const files = parseDiffs(diffText);
    expect(files.length).toBe(1);
    expect(files[0]?.status).toBe("deleted");
  });

  test("detects renamed files", () => {
    const diffText = `diff --git a/src/old.ts b/src/new.ts
similarity index 100%
rename from src/old.ts
rename to src/new.ts`;

    const files = parseDiffs(diffText);
    expect(files.length).toBe(1);
    expect(files[0]?.status).toBe("renamed");
    expect(files[0]?.oldPath).toBe("src/old.ts");
    expect(files[0]?.filePath).toBe("src/new.ts");
  });

  test("returns empty array for empty diff", () => {
    const files = parseDiffs("");
    expect(files.length).toBe(0);
  });

  test("handles multiple hunks in same file", () => {
    const diffText = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,3 @@
 line1
-old1
+new1
@@ -10,3 +10,3 @@
 line10
-old2
+new2`;

    const files = parseDiffs(diffText);
    expect(files.length).toBe(1);
    expect(files[0]?.hunks.length).toBe(2);
  });
});

describe("resolveHunkIdToPatch", () => {
  test("finds correct hunk by ID", () => {
    const diffText = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,3 @@
 line1
-old
+new
 line3`;
    const files = parseDiffs(diffText);
    const hunk = files[0]?.hunks[0];
    expect(hunk).toBeDefined();

    const hunkId = computeHunkId(hunk!.header + "\n" + hunk!.content);
    const patch = resolveHunkIdToPatch(hunkId, files);

    expect(patch).not.toBeNull();
    expect(patch?.filePath).toBe("src/a.ts");
    expect(patch?.patch).toContain("diff --git");
    expect(patch?.patch).toContain(hunk!.header);
  });

  test("returns null for unknown hunk ID", () => {
    const files = parseDiffs("diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new");
    const patch = resolveHunkIdToPatch("nonexistent-id", files);
    expect(patch).toBeNull();
  });

  test("handles renamed files correctly", () => {
    const diffText = `diff --git a/src/old.ts b/src/new.ts
--- a/src/old.ts
+++ b/src/new.ts
@@ -1 +1 @@
-old
+new`;
    const files = parseDiffs(diffText);
    const hunk = files[0]?.hunks[0];
    expect(hunk).toBeDefined();

    const hunkId = computeHunkId(hunk!.header + "\n" + hunk!.content);
    const patch = resolveHunkIdToPatch(hunkId, files);

    expect(patch).not.toBeNull();
    expect(patch?.oldPath).toBe("src/old.ts");
    expect(patch?.filePath).toBe("src/new.ts");
    expect(patch?.patch).toContain("a/src/old.ts");
    expect(patch?.patch).toContain("b/src/new.ts");
  });
});

describe("getDiffs", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(import.meta.dir, `.test-diffs-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    await $`git init`.cwd(testDir).quiet();
    await $`git config user.email "test@test.com"`.cwd(testDir).quiet();
    await $`git config user.name "Test User"`.cwd(testDir).quiet();

    // Create initial commit
    await writeFile(join(testDir, "initial.txt"), "initial");
    await $`git add .`.cwd(testDir).quiet();
    await $`git commit -m "initial"`.cwd(testDir).quiet();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("returns empty array for clean repo", async () => {
    const diffs = await getDiffs(undefined, testDir);
    expect(diffs.length).toBe(0);
  });

  test("returns current uncommitted changes", async () => {
    await writeFile(join(testDir, "file.txt"), "content");
    await $`git add file.txt`.cwd(testDir).quiet();

    // Make a change without staging
    await writeFile(join(testDir, "file.txt"), "modified");

    const diffs = await getDiffs(undefined, testDir);
    expect(diffs.length).toBe(1);
    expect(diffs[0]?.filePath).toBe("file.txt");
    expect(diffs[0]?.hunks.length).toBeGreaterThan(0);
  });

  test("returns diffs between two commits", async () => {
    // Create first commit with file
    await writeFile(join(testDir, "file.txt"), "version1");
    await $`git add file.txt`.cwd(testDir).quiet();
    await $`git commit -m "v1"`.cwd(testDir).quiet();
    const v1Hash = (await $`git rev-parse HEAD`.cwd(testDir).text()).trim();

    // Create second commit with modification
    await writeFile(join(testDir, "file.txt"), "version2");
    await $`git add file.txt`.cwd(testDir).quiet();
    await $`git commit -m "v2"`.cwd(testDir).quiet();

    const diffs = await getDiffs(v1Hash, testDir);
    expect(diffs.length).toBe(1);
    expect(diffs[0]?.filePath).toBe("file.txt");
  });

  test("hunk IDs are stable across multiple getDiffs calls", async () => {
    await writeFile(join(testDir, "file.txt"), "original\nline2\nline3");
    await $`git add file.txt`.cwd(testDir).quiet();
    await $`git commit -m "initial"`.cwd(testDir).quiet();

    // Make a change
    await writeFile(join(testDir, "file.txt"), "original\nmodified\nline3");

    const diffs1 = await getDiffs(undefined, testDir);
    const diffs2 = await getDiffs(undefined, testDir);

    expect(diffs1.length).toBe(diffs2.length);
    expect(diffs1[0]?.hunks.length).toBe(diffs2[0]?.hunks.length);

    const hunkId1 = computeHunkId(diffs1[0]!.hunks[0]!.header + "\n" + diffs1[0]!.hunks[0]!.content);
    const hunkId2 = computeHunkId(diffs2[0]!.hunks[0]!.header + "\n" + diffs2[0]!.hunks[0]!.content);
    expect(hunkId1).toBe(hunkId2);
  });
});

describe("stageHunksByIds", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(import.meta.dir, `.test-stage-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    await $`git init`.cwd(testDir).quiet();
    await $`git config user.email "test@test.com"`.cwd(testDir).quiet();
    await $`git config user.name "Test User"`.cwd(testDir).quiet();

    // Create initial commit
    await writeFile(join(testDir, "initial.txt"), "initial");
    await $`git add .`.cwd(testDir).quiet();
    await $`git commit -m "initial"`.cwd(testDir).quiet();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("stages specified hunks by ID", async () => {
    await writeFile(join(testDir, "file.txt"), "line1\nold\nline3");
    await $`git add file.txt`.cwd(testDir).quiet();
    await $`git commit -m "add file"`.cwd(testDir).quiet();

    // Make changes
    await writeFile(join(testDir, "file.txt"), "line1\nnew\nline3");

    const diffs = await getDiffs(undefined, testDir);
    expect(diffs.length).toBe(1);

    const hunkId = computeHunkId(diffs[0]!.hunks[0]!.header + "\n" + diffs[0]!.hunks[0]!.content);
    const result = await stageHunksByIds([hunkId], diffs, testDir);

    expect(result.ok).toBe(true);

    // Verify hunk is staged
    const staged = await $`git diff --cached --stat`.cwd(testDir).text();
    expect(staged).toContain("file.txt");
  });

  test("returns error for unknown hunk ID", async () => {
    const diffs = await getDiffs(undefined, testDir);
    const result = await stageHunksByIds(["nonexistent-id"], diffs, testDir);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not found");
    }
  });

  test("stageFullFile stages entire file", async () => {
    await writeFile(join(testDir, "file.txt"), "content");
    await $`git add file.txt`.cwd(testDir).quiet();
    await $`git commit -m "add file"`.cwd(testDir).quiet();

    // Make a change
    await writeFile(join(testDir, "file.txt"), "modified");

    const result = await stageFullFile("file.txt", testDir);
    expect(result.ok).toBe(true);

    // Verify file is staged
    const staged = await $`git diff --cached --stat`.cwd(testDir).text();
    expect(staged).toContain("file.txt");
  });

  test("unstageAll clears staging area", async () => {
    await writeFile(join(testDir, "file.txt"), "content");
    await $`git add file.txt`.cwd(testDir).quiet();

    // Verify something is staged
    let staged = await $`git diff --cached --stat`.cwd(testDir).text();
    expect(staged).toContain("file.txt");

    // Unstage using the function
    await unstageAll(testDir);

    staged = await $`git diff --cached --stat`.cwd(testDir).text();
    expect(staged.trim()).toBe("");
  });
});

describe("rollbackHunks", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(import.meta.dir, `.test-rollback-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    await $`git init`.cwd(testDir).quiet();
    await $`git config user.email "test@test.com"`.cwd(testDir).quiet();
    await $`git config user.name "Test User"`.cwd(testDir).quiet();

    // Create initial commit
    await writeFile(join(testDir, "initial.txt"), "initial");
    await $`git add .`.cwd(testDir).quiet();
    await $`git commit -m "initial"`.cwd(testDir).quiet();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("rollback unstages all changes", async () => {
    await writeFile(join(testDir, "file.txt"), "content");
    await $`git add file.txt`.cwd(testDir).quiet();

    // Verify staged
    let staged = await $`git diff --cached --stat`.cwd(testDir).text();
    expect(staged).toContain("file.txt");

    // Rollback
    const result = await rollbackHunks([], testDir);
    expect(result.ok).toBe(true);

    // Verify unstaged
    staged = await $`git diff --cached --stat`.cwd(testDir).text();
    expect(staged.trim()).toBe("");
  });
});

describe("createCommitWithDate", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(import.meta.dir, `.test-commit-date-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    await $`git init`.cwd(testDir).quiet();
    await $`git config user.email "test@test.com"`.cwd(testDir).quiet();
    await $`git config user.name "Test User"`.cwd(testDir).quiet();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("creates commit with specified date and author", async () => {
    await writeFile(join(testDir, "file.txt"), "content");
    await $`git add file.txt`.cwd(testDir).quiet();

    const date = new Date("2024-06-15T14:30:00Z");
    const result = await createCommitWithDate("test: commit", date, "Custom Author", "custom@example.com", false, testDir);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeTruthy();
    }

    // Verify commit date
    const commitDate = await $`git log -1 --format=%ai`.cwd(testDir).text();
    expect(commitDate.trim()).toContain("2024-06-15");

    // Verify author
    const author = await $`git log -1 --format=%an%x00%ae`.cwd(testDir).text();
    expect(author.trim()).toBe("Custom Author\0custom@example.com");
  });

  test("returns error for commit without staged changes", async () => {
    const result = await createCommitWithDate("empty commit", new Date(), undefined, undefined, false, testDir);
    expect(result.ok).toBe(false);
  });
});
