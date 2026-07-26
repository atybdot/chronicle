import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { $ } from "bun";
import { CommitPlanner } from "../src/lib/agents/commit-planner";
import type { HunkSummary, HunkDetail, CommitGroup } from "../src/types";

describe("CommitPlanner", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "commit-planner-test-"));
    await $`git init`.cwd(tempDir);
    await $`git config user.email "test@test.com"`.cwd(tempDir);
    await $`git config user.name "Test"`.cwd(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("group_hunks", () => {
    test("groups hunks into logical commit groups based on intent", () => {
      const summaries: HunkSummary[] = [
        {
          id: "src/auth.ts-1",
          filePath: "src/auth.ts",
          hunkIds: ["abc123"],
          hunkCount: 1,
          addedTotal: 10,
          removedTotal: 2,
          semanticLabels: ["addition", "feature"],
          preview: "Changes in src/auth.ts: +10 -2 lines",
        },
        {
          id: "src/auth.test.ts-1",
          filePath: "src/auth.test.ts",
          hunkIds: ["def456"],
          hunkCount: 1,
          addedTotal: 5,
          removedTotal: 0,
          semanticLabels: ["addition", "test"],
          preview: "Changes in src/auth.test.ts: +5 -0 lines",
        },
        {
          id: "src/pagination.ts-1",
          filePath: "src/pagination.ts",
          hunkIds: ["ghi789"],
          hunkCount: 1,
          addedTotal: 3,
          removedTotal: 3,
          semanticLabels: ["modification", "fix"],
          preview: "Changes in src/pagination.ts: +3 -3 lines",
        },
      ];

      const result = CommitPlanner.groupHunks(summaries, "add authentication");
      expect(Array.isArray(result)).toBe(true);
      if (!Array.isArray(result)) throw new Error(result.error);
      
      const groups = result;
      expect(groups.length).toBeGreaterThanOrEqual(2);
      
      // Auth-related files should be grouped together
      const authGroup = groups.find((g: CommitGroup) => 
        g.filePaths.some((p: string) => p.includes("auth"))
      );
      expect(authGroup).toBeDefined();
      expect(authGroup?.category).toBe("feature");
      
      // Pagination should be separate
      const paginationGroup = groups.find((g: CommitGroup) => 
        g.filePaths.some((p: string) => p.includes("pagination"))
      );
      expect(paginationGroup).toBeDefined();
    });

    test("each group has a unique groupId", () => {
      const summaries: HunkSummary[] = [
        {
          id: "src/a.ts-1",
          filePath: "src/a.ts",
          hunkIds: ["a1"],
          hunkCount: 1,
          addedTotal: 5,
          removedTotal: 0,
          semanticLabels: ["addition"],
          preview: "Changes in src/a.ts",
        },
        {
          id: "src/b.ts-1",
          filePath: "src/b.ts",
          hunkIds: ["b1"],
          hunkCount: 1,
          addedTotal: 5,
          removedTotal: 0,
          semanticLabels: ["addition"],
          preview: "Changes in src/b.ts",
        },
      ];

      const result = CommitPlanner.groupHunks(summaries);
      expect(Array.isArray(result)).toBe(true);
      if (!Array.isArray(result)) throw new Error(result.error);
      
      const groups = result;
      const ids = groups.map((g: CommitGroup) => g.id);
      const uniqueIds = new Set(ids);
      
      expect(uniqueIds.size).toBe(ids.length);
    });

    test("groups respect atomic commit principles", () => {
      const summaries: HunkSummary[] = [
        {
          id: "src/feature-a.ts-1",
          filePath: "src/feature-a.ts",
          hunkIds: ["fa1"],
          hunkCount: 1,
          addedTotal: 10,
          removedTotal: 0,
          semanticLabels: ["addition", "feature"],
          preview: "Changes in src/feature-a.ts",
        },
        {
          id: "src/feature-b.ts-1",
          filePath: "src/feature-b.ts",
          hunkIds: ["fb1"],
          hunkCount: 1,
          addedTotal: 10,
          removedTotal: 0,
          semanticLabels: ["addition", "feature"],
          preview: "Changes in src/feature-b.ts",
        },
      ];

      const result = CommitPlanner.groupHunks(summaries, "add two features");
      expect(Array.isArray(result)).toBe(true);
      if (!Array.isArray(result)) throw new Error(result.error);
      
      const groups = result;

      // Each feature should be its own group
      expect(groups.length).toBeGreaterThanOrEqual(2);
    });

    test("returns error if no hunks to plan", () => {
      const result = CommitPlanner.groupHunks([]);
      expect(Array.isArray(result)).toBe(false);
      if (Array.isArray(result)) throw new Error("Expected error");
      expect(result.error).toBe("No hunks to plan");
    });

    test("handles single-file changes with one group", () => {
      const summaries: HunkSummary[] = [
        {
          id: "src/single.ts-1",
          filePath: "src/single.ts",
          hunkIds: ["s1"],
          hunkCount: 1,
          addedTotal: 5,
          removedTotal: 2,
          semanticLabels: ["modification"],
          preview: "Changes in src/single.ts",
        },
      ];

      const result = CommitPlanner.groupHunks(summaries);
      expect(Array.isArray(result)).toBe(true);
      if (!Array.isArray(result)) throw new Error(result.error);
      
      const groups = result;
      expect(groups.length).toBe(1);
      expect(groups[0]?.filePaths).toEqual(["src/single.ts"]);
    });
  });

  describe("request_hunk_detail", () => {
    test("returns full hunk content for requested IDs", () => {
      const details: HunkDetail[] = [
        {
          hunkId: "hunk-1",
          fullContent: "@@ -1,5 +1,6 @@\n line1\n+added line\n-removed line\n line2\n line3",
          surroundingContext: "line1\nline2\nline3",
        },
      ];

      const result = CommitPlanner.requestHunkDetail(["hunk-1"], details);
      expect(result.hunks.length).toBe(1);
      expect(result.hunks[0]?.hunkId).toBe("hunk-1");
      expect(result.hunks[0]?.fullContent).toContain("added line");
    });

    test("returns empty array for non-existent IDs", () => {
      const result = CommitPlanner.requestHunkDetail(["non-existent"], []);
      expect(result.hunks.length).toBe(0);
    });
  });
});
