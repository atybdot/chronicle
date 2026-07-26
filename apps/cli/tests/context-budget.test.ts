import { describe, it, expect } from "bun:test";
import { calculateAnalysisStrategy, batchHunksForAnalysis, mergeSummaries } from "../src/lib/context-budget";
import type { HunkSummary } from "../src/types";

describe("Context Budget", () => {
  describe("calculateAnalysisStrategy", () => {
    it("should return 'full' detail for < 200 lines", () => {
      const result = calculateAnalysisStrategy(100, 8000);
      expect(result.detail).toBe("full");
      expect(result.maxPasses).toBe(1);
    });

    it("should return 'compact' detail for 200-1000 lines", () => {
      const result = calculateAnalysisStrategy(500, 8000);
      expect(result.detail).toBe("compact");
      expect(result.maxPasses).toBeGreaterThanOrEqual(1);
    });

    it("should return 'summary' detail for > 1000 lines", () => {
      const result = calculateAnalysisStrategy(1500, 8000);
      expect(result.detail).toBe("summary");
      expect(result.maxPasses).toBeGreaterThanOrEqual(1);
    });

    it("should have maxPasses at least 1", () => {
      const result1 = calculateAnalysisStrategy(100, 8000);
      const result2 = calculateAnalysisStrategy(500, 8000);
      const result3 = calculateAnalysisStrategy(1500, 8000);

      expect(result1.maxPasses).toBeGreaterThanOrEqual(1);
      expect(result2.maxPasses).toBeGreaterThanOrEqual(1);
      expect(result3.maxPasses).toBeGreaterThanOrEqual(1);
    });

    it("should have positive maxHunksPerPass", () => {
      const result1 = calculateAnalysisStrategy(100, 8000);
      const result2 = calculateAnalysisStrategy(500, 8000);
      const result3 = calculateAnalysisStrategy(1500, 8000);

      expect(result1.maxHunksPerPass).toBeGreaterThan(0);
      expect(result2.maxHunksPerPass).toBeGreaterThan(0);
      expect(result3.maxHunksPerPass).toBeGreaterThan(0);
    });

    it("should handle 0 changed lines", () => {
      const result = calculateAnalysisStrategy(0, 8000);
      expect(result.detail).toBe("full");
      expect(result.maxPasses).toBe(1);
    });

    it("should handle very large effective limit", () => {
      const result = calculateAnalysisStrategy(100, 1000000);
      expect(result.detail).toBe("full");
      expect(result.maxPasses).toBe(1);
    });

    it("should handle very small effective limit", () => {
      const result = calculateAnalysisStrategy(500, 4000);
      expect(result.detail).toBe("compact");
      expect(result.maxPasses).toBeGreaterThanOrEqual(1);
    });
  });

  describe("batchHunksForAnalysis", () => {
    it("should produce batches that respect maxHunksPerPass", () => {
      const hunks: HunkSummary[] = Array.from({ length: 10 }, (_, i) => ({
        id: `hunk-${i}`,
        filePath: `src/file-${i}.ts`,
        hunkIds: [`hash-${i}`],
        hunkCount: 1,
        addedTotal: 10,
        removedTotal: 5,
        semanticLabels: ["feature"],
        preview: `preview ${i}`,
      }));

      const strategy = {
        detail: "full" as const,
        maxPasses: 1,
        maxHunksPerPass: 3,
        estimatedTokensPerHunk: 100,
      };

      const batches = batchHunksForAnalysis(hunks, strategy);

      expect(batches.length).toBe(4); // ceil(10/3) = 4
      expect(batches[0]?.length).toBe(3);
      expect(batches[1]?.length).toBe(3);
      expect(batches[2]?.length).toBe(3);
      expect(batches[3]?.length).toBe(1);
    });

    it("should preserve hunk order within batches", () => {
      const hunks: HunkSummary[] = [
        { id: "hunk-0", filePath: "a.ts", hunkIds: ["h0"], hunkCount: 1, addedTotal: 10, removedTotal: 5, semanticLabels: [], preview: "" },
        { id: "hunk-1", filePath: "b.ts", hunkIds: ["h1"], hunkCount: 1, addedTotal: 10, removedTotal: 5, semanticLabels: [], preview: "" },
        { id: "hunk-2", filePath: "c.ts", hunkIds: ["h2"], hunkCount: 1, addedTotal: 10, removedTotal: 5, semanticLabels: [], preview: "" },
      ];

      const strategy = {
        detail: "full" as const,
        maxPasses: 1,
        maxHunksPerPass: 2,
        estimatedTokensPerHunk: 100,
      };

      const batches = batchHunksForAnalysis(hunks, strategy);

      expect(batches[0]?.[0]?.id).toBe("hunk-0");
      expect(batches[0]?.[1]?.id).toBe("hunk-1");
      expect(batches[1]?.[0]?.id).toBe("hunk-2");
    });

    it("should handle 0 hunks", () => {
      const hunks: HunkSummary[] = [];
      const strategy = {
        detail: "full" as const,
        maxPasses: 1,
        maxHunksPerPass: 10,
        estimatedTokensPerHunk: 100,
      };

      const batches = batchHunksForAnalysis(hunks, strategy);

      expect(batches.length).toBe(0);
    });

    it("should return single batch when fewer hunks than limit", () => {
      const hunks: HunkSummary[] = [
        { id: "hunk-0", filePath: "a.ts", hunkIds: ["h0"], hunkCount: 1, addedTotal: 10, removedTotal: 5, semanticLabels: [], preview: "" },
        { id: "hunk-1", filePath: "b.ts", hunkIds: ["h1"], hunkCount: 1, addedTotal: 10, removedTotal: 5, semanticLabels: [], preview: "" },
      ];
      const strategy = {
        detail: "full" as const,
        maxPasses: 1,
        maxHunksPerPass: 10,
        estimatedTokensPerHunk: 100,
      };

      const batches = batchHunksForAnalysis(hunks, strategy);

      expect(batches.length).toBe(1);
      expect(batches[0]?.length).toBe(2);
    });
  });

  describe("mergeSummaries", () => {
    it("should flatten correctly and preserve order", () => {
      const batches: HunkSummary[][] = [
        [
          { id: "hunk-0", filePath: "a.ts", hunkIds: ["h0"], hunkCount: 1, addedTotal: 10, removedTotal: 5, semanticLabels: [], preview: "" },
          { id: "hunk-1", filePath: "b.ts", hunkIds: ["h1"], hunkCount: 1, addedTotal: 10, removedTotal: 5, semanticLabels: [], preview: "" },
        ],
        [
          { id: "hunk-2", filePath: "c.ts", hunkIds: ["h2"], hunkCount: 1, addedTotal: 10, removedTotal: 5, semanticLabels: [], preview: "" },
        ],
      ];

      const result = mergeSummaries(batches);

      expect(result.length).toBe(3);
      expect(result[0]?.id).toBe("hunk-0");
      expect(result[1]?.id).toBe("hunk-1");
      expect(result[2]?.id).toBe("hunk-2");
    });

    it("should handle empty batches", () => {
      const batches: HunkSummary[][] = [];
      const result = mergeSummaries(batches);
      expect(result.length).toBe(0);
    });
  });
});
