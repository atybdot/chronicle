import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { __internal } from "../src/lib/ai";

describe("AI structured output fallback helpers", () => {
  test("detects unsupported json_schema errors", () => {
    expect(
      __internal.isStructuredOutputUnsupportedError(
        new Error("This model does not support response format `json_schema`.")
      )
    ).toBe(true);

    expect(__internal.isStructuredOutputUnsupportedError(new Error("network timeout"))).toBe(false);
  });

  test("builds a fallback prompt with JSON schema guidance", () => {
    const prompt = __internal.buildSchemaFallbackPrompt(
      "Analyze this diff.",
      z.object({
        result: z.string(),
        count: z.number(),
      })
    );

    expect(prompt).toContain("Analyze this diff.");
    expect(prompt).toContain("Return only a JSON object");
    expect(prompt).toContain('"type": "object"');
    expect(prompt).toContain('"result"');
    expect(prompt).toContain('"count"');
  });

  test("adds deterministic fallback groups for omitted hunks", () => {
    const allHunks = [
      {
        id: "src/a.ts:hunk-0",
        path: "src/a.ts",
        status: "modified",
        hunkIndex: 0,
        newStart: 10,
        newEnd: 14,
        added: 2,
        removed: 1,
        changeType: "mixed",
        preview: "",
        priority: 3,
      },
      {
        id: "src/a.ts:hunk-1",
        path: "src/a.ts",
        status: "modified",
        hunkIndex: 1,
        newStart: 30,
        newEnd: 34,
        added: 3,
        removed: 0,
        changeType: "addition",
        preview: "",
        priority: 3,
      },
      {
        id: "docs/guide.md:hunk-0",
        path: "docs/guide.md",
        status: "modified",
        hunkIndex: 0,
        newStart: 1,
        newEnd: 5,
        added: 1,
        removed: 1,
        changeType: "mixed",
        preview: "",
        priority: 0,
      },
    ] as const;

    const normalized = __internal.normalizeAnalysisGroups(
      [
        {
          name: "feature work",
          description: "Covers the selected hunk",
          hunkIds: ["src/a.ts:hunk-0"],
          category: "feature",
          order: 1,
        },
      ],
      [...allHunks],
      new Set(["src/a.ts:hunk-0"]),
    );

    expect(normalized.fallbackGroupCount).toBe(2);
    expect(normalized.fallbackHunkCount).toBe(2);
    expect(normalized.groups).toHaveLength(3);

    const omittedCodeGroup = normalized.groups.find((group) => group.name === "include remaining changes in src/a.ts");
    expect(omittedCodeGroup?.hunkIds).toEqual(["src/a.ts:hunk-1"]);
    expect(omittedCodeGroup?.description).toContain("omitted from AI context");

    const docsGroup = normalized.groups.find((group) => group.name === "include remaining changes in docs/guide.md");
    expect(docsGroup?.category).toBe("docs");

    const analysisGroups = __internal.buildAnalysisGroupsFromHunkGroups(normalized.groups, [...allHunks]);
    const fileGroup = analysisGroups.find((group) => group.files.includes("src/a.ts") && group.name.includes("remaining"));
    expect(fileGroup?.fileHunks[0]?.hunkIndices).toEqual([1]);
  });

  test("splits groups so no more than two analyzable files share a commit", () => {
    const groups = __internal.splitAnalysisGroupsByFileLimit([
      {
        name: "ship related updates",
        description: "Keep related changes together without over-grouping files",
        files: ["src/a.ts", "src/b.ts", "src/c.ts"],
        fileHunks: [
          {
            path: "src/a.ts",
            lineRanges: [{ start: 1, end: 4 }],
            hunkIndices: [0],
          },
          {
            path: "src/b.ts",
            lineRanges: [{ start: 5, end: 9 }],
            hunkIndices: [0],
          },
          {
            path: "src/c.ts",
            lineRanges: [{ start: 10, end: 14 }],
            hunkIndices: [0],
          },
        ],
        category: "feature",
        order: 1,
      },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.files)).toEqual([
      ["src/a.ts", "src/b.ts"],
      ["src/c.ts"],
    ]);
    expect(groups.every((group) => group.fileHunks.length <= 2)).toBe(true);
  });

  test("attaches matched assets and creates fallback asset commits", () => {
    const groups = [
      {
        name: "update button styles",
        description: "Wire the hero illustration into the updated button surface",
        files: ["src/components/Button.tsx", "src/styles/button.css"],
        fileHunks: [
          {
            path: "src/components/Button.tsx",
            lineRanges: [{ start: 1, end: 12 }],
            hunkIndices: [0],
          },
        ],
        category: "feature",
        order: 1,
      },
    ];

    const result = __internal.attachAssetsToGroups([...groups], [
      { path: "public/button-hero.png", status: "added" },
      { path: "public/unmatched-logo.png", status: "added" },
    ]);

    expect(result.summary.attachedAssetCount).toBe(1);
    expect(result.summary.fallbackAssetCount).toBe(1);

    const featureGroup = result.groups.find((group) => group.name === "update button styles");
    expect(featureGroup?.files).toContain("public/button-hero.png");

    const fallbackGroup = result.groups.find((group) => group.files.includes("public/unmatched-logo.png"));
    expect(fallbackGroup?.commitMessage).toBe("chore: include asset public/unmatched-logo.png");
    expect(fallbackGroup?.category).toBe("chore");
  });

  test("infers non-chore fallback categories from path hints", () => {
    expect(__internal.normalizeAnalysisGroups(
      [],
      [
        {
          id: "docs/readme.md:hunk-0",
          path: "docs/readme.md",
          status: "modified",
          hunkIndex: 0,
          newStart: 1,
          newEnd: 2,
          added: 1,
          removed: 0,
          changeType: "addition",
          preview: "",
          priority: 0,
        },
        {
          id: "src/fix-login.ts:hunk-0",
          path: "src/fix-login.ts",
          status: "modified",
          hunkIndex: 0,
          newStart: 1,
          newEnd: 2,
          added: 1,
          removed: 0,
          changeType: "addition",
          preview: "",
          priority: 3,
        },
      ],
      new Set(),
    ).groups.map((group) => group.category)).toEqual(["docs", "fix"]);
  });
});
