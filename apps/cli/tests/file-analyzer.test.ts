import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { $ } from "bun";
import {
  classifyChangedFiles,
  extractHunksFromChanges,
  getHunkDetails,
} from "../src/lib/agents/file-analyzer";
import type { FileChange, Hunk } from "../src/types";
import { computeHunkId } from "../src/lib/git";

function makeClassifications(...paths: string[]): Map<string, { path: string; kind: "analyzable" | "asset"; reason: string }> {
  const classifications = new Map<string, { path: string; kind: "analyzable" | "asset"; reason: string }>();
  for (const path of paths) {
    classifications.set(path, { path, kind: "analyzable", reason: "test" });
  }
  return classifications;
}

describe("FileAnalyzer", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "file-analyzer-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("classifyChangedFiles", () => {
    test("classifies source code files as analyzable", () => {
      const files: FileChange[] = [
        { path: "src/index.ts", status: "modified" },
        { path: "src/utils.ts", status: "added" },
        { path: "README.md", status: "modified" },
      ];
      const diffs = new Map<string, string>();

      const classifications = classifyChangedFiles(files, diffs);

      expect(classifications.get("src/index.ts")?.kind).toBe("analyzable");
      expect(classifications.get("src/utils.ts")?.kind).toBe("analyzable");
      expect(classifications.get("README.md")?.kind).toBe("analyzable");
    });

    test("classifies asset files as non-analyzable", () => {
      const files: FileChange[] = [
        { path: "images/logo.png", status: "added" },
        { path: "fonts/custom.woff2", status: "added" },
        { path: "archive.zip", status: "added" },
      ];
      const diffs = new Map<string, string>();

      const classifications = classifyChangedFiles(files, diffs);

      expect(classifications.get("images/logo.png")?.kind).toBe("asset");
      expect(classifications.get("fonts/custom.woff2")?.kind).toBe("asset");
      expect(classifications.get("archive.zip")?.kind).toBe("asset");
    });

    test("classifies node_modules files as non-analyzable", () => {
      const files: FileChange[] = [
        { path: "node_modules/package/index.js", status: "modified" },
      ];
      const diffs = new Map<string, string>();

      const classifications = classifyChangedFiles(files, diffs);

      expect(classifications.get("node_modules/package/index.js")?.kind).toBe("asset");
    });

    test("classifies dist and build directories as non-analyzable", () => {
      const files: FileChange[] = [
        { path: "dist/index.js", status: "added" },
        { path: "build/bundle.js", status: "modified" },
      ];
      const diffs = new Map<string, string>();

      const classifications = classifyChangedFiles(files, diffs);

      expect(classifications.get("dist/index.js")?.kind).toBe("asset");
      expect(classifications.get("build/bundle.js")?.kind).toBe("asset");
    });
  });

  describe("extractHunksFromChanges", () => {
    test("extracts hunks from analyzable files", () => {
      const files: FileChange[] = [
        { path: "src/index.ts", status: "modified" },
      ];
      const diffs = new Map<string, string>();
      diffs.set("src/index.ts", "@@ -1,3 +1,4 @@\n line1\n+new line\n line2\n line3");

      const classifications = makeClassifications("src/index.ts");

      const { hunks, summaries } = extractHunksFromChanges(files, diffs, classifications);

      expect(hunks.length).toBe(1);
      expect(hunks[0]?.filePath).toBe("src/index.ts");
      expect(hunks[0]?.status).toBe("modified");
      expect(hunks[0]?.addedLines).toBe(1);
      expect(summaries.length).toBe(1);
      expect(summaries[0]?.filePath).toBe("src/index.ts");
    });

    test("skips asset files", () => {
      const files: FileChange[] = [
        { path: "images/logo.png", status: "added" },
      ];
      const diffs = new Map<string, string>();
      diffs.set("images/logo.png", "binary content");

      const classifications = new Map<string, { path: string; kind: "analyzable" | "asset"; reason: string }>();
      classifications.set("images/logo.png", { path: "images/logo.png", kind: "asset", reason: "test" });

      const { hunks, summaries } = extractHunksFromChanges(files, diffs, classifications);

      expect(hunks.length).toBe(0);
      expect(summaries.length).toBe(0);
    });

    test("generates correct semantic labels", () => {
      const files: FileChange[] = [
        { path: "src/index.ts", status: "modified" },
      ];
      const diffs = new Map<string, string>();
      diffs.set(
        "src/index.ts",
        "@@ -1,3 +1,5 @@\n line1\n+added line1\n+added line2\n-removed line\n line2\n line3"
      );

      const classifications = makeClassifications("src/index.ts");

      const { summaries } = extractHunksFromChanges(files, diffs, classifications);

      // The diff has both additions and deletions, so it should be "mixed"
      expect(summaries[0]?.semanticLabels).toContain("addition");
      expect(summaries[0]?.semanticLabels).toContain("deletion");
      expect(summaries[0]?.semanticLabels).toContain("modification");
    });

    test("generates content-based IDs (cross-run stability)", () => {
      const files: FileChange[] = [
        { path: "src/index.ts", status: "modified" },
      ];
      
      // Same content AND same line positions
      const diffs1 = new Map<string, string>();
      diffs1.set("src/index.ts", "@@ -1,3 +1,4 @@\n line1\n+new line\n line2\n line3");
      
      const diffs2 = new Map<string, string>();
      diffs2.set("src/index.ts", "@@ -1,3 +1,4 @@\n line1\n+new line\n line2\n line3");

      const classifications = makeClassifications("src/index.ts");

      const { hunks: hunks1 } = extractHunksFromChanges(files, diffs1, classifications);
      const { hunks: hunks2 } = extractHunksFromChanges(files, diffs2, classifications);

      // Same diff content at same positions should produce same ID
      expect(hunks1[0]?.id).toBe(hunks2[0]?.id);
    });

    test("different content produces different IDs", () => {
      const files: FileChange[] = [
        { path: "src/index.ts", status: "modified" },
      ];
      
      const diffs1 = new Map<string, string>();
      diffs1.set("src/index.ts", "@@ -1,3 +1,4 @@\n line1\n+new line A\n line2\n line3");
      
      const diffs2 = new Map<string, string>();
      diffs2.set("src/index.ts", "@@ -1,3 +1,4 @@\n line1\n+new line B\n line2\n line3");

      const classifications = makeClassifications("src/index.ts");

      const { hunks: hunks1 } = extractHunksFromChanges(files, diffs1, classifications);
      const { hunks: hunks2 } = extractHunksFromChanges(files, diffs2, classifications);

      // Different content should produce different IDs
      expect(hunks1[0]?.id).not.toBe(hunks2[0]?.id);
    });

    test("hash includes @@ header line per spec", () => {
      const files: FileChange[] = [
        { path: "src/index.ts", status: "modified" },
      ];
      
      // Same diff content but different @@ headers
      const diffs1 = new Map<string, string>();
      diffs1.set("src/index.ts", "@@ -1,3 +1,4 @@\n line1\n+new line\n line2\n line3");
      
      const diffs2 = new Map<string, string>();
      diffs2.set("src/index.ts", "@@ -5,3 +5,4 @@\n line1\n+new line\n line2\n line3");

      const classifications = makeClassifications("src/index.ts");

      const { hunks: hunks1 } = extractHunksFromChanges(files, diffs1, classifications);
      const { hunks: hunks2 } = extractHunksFromChanges(files, diffs2, classifications);

      // Hash includes @@ header per spec, so different headers → different IDs
      expect(hunks1[0]?.id).not.toBe(hunks2[0]?.id);
    });
  });

  describe("getHunkDetails", () => {
    test("returns full hunk content for requested IDs", () => {
      const hunks: Hunk[] = [
        {
          id: "hunk-1",
          filePath: "src/index.ts",
          status: "modified",
          hunkIndex: 0,
          newStart: 1,
          newEnd: 3,
          addedLines: 1,
          removedLines: 0,
          changeType: "addition",
        },
      ];

      const diffs = new Map<string, string>();
      diffs.set("src/index.ts", "@@ -1,3 +1,4 @@\n line1\n+new line\n line2\n line3");

      const result = getHunkDetails(["hunk-1"], hunks, diffs);

      expect(result.hunks.length).toBe(1);
      expect(result.hunks[0]?.hunkId).toBe("hunk-1");
      expect(result.hunks[0]?.fullContent).toContain("line1");
      expect(result.hunks[0]?.fullContent).toContain("+new line");
    });

    test("returns empty array for unknown hunk IDs", () => {
      const hunks: Hunk[] = [];
      const diffs = new Map<string, string>();

      const result = getHunkDetails(["unknown-id"], hunks, diffs);

      expect(result.hunks.length).toBe(0);
    });

    test("handles multiple hunk IDs", () => {
      const hunks: Hunk[] = [
        {
          id: "hunk-1",
          filePath: "src/index.ts",
          status: "modified",
          hunkIndex: 0,
          newStart: 1,
          newEnd: 3,
          addedLines: 1,
          removedLines: 0,
          changeType: "addition",
        },
        {
          id: "hunk-2",
          filePath: "src/utils.ts",
          status: "added",
          hunkIndex: 0,
          newStart: 1,
          newEnd: 5,
          addedLines: 5,
          removedLines: 0,
          changeType: "addition",
        },
      ];

      const diffs = new Map<string, string>();
      diffs.set("src/index.ts", "@@ -1,3 +1,4 @@\n line1\n+new line\n line2\n line3");
      diffs.set("src/utils.ts", "@@ -0,0 +1,5 @@\n+line1\n+line2\n+line3\n+line4\n+line5");

      const result = getHunkDetails(["hunk-1", "hunk-2"], hunks, diffs);

      expect(result.hunks.length).toBe(2);
      expect(result.hunks[0]?.hunkId).toBe("hunk-1");
      expect(result.hunks[1]?.hunkId).toBe("hunk-2");
    });
  });
});
