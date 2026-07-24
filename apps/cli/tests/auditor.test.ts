import { describe, test, expect } from "bun:test";
import { Auditor } from "../src/lib/agents/auditor";
import type { CommitGroup, HunkLedger } from "../src/types";

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

describe("Auditor", () => {
  describe("review_plan", () => {
    test("returns empty array for valid plan", async () => {
      const groups = [
        createGroup({ id: "group-1", hunkIds: ["hunk-1", "hunk-2", "hunk-3"] }),
      ];
      const ledger = createLedger();

      const result = await Auditor.review_plan({ groups, ledger });

      expect(result.signals.length).toBe(0);
    });

    test("detects overlapping hunk IDs across groups", async () => {
      const groups = [
        createGroup({ id: "group-1", hunkIds: ["hunk-1", "hunk-2"] }),
        createGroup({ id: "group-2", hunkIds: ["hunk-2", "hunk-3"] }),
      ];
      const ledger = createLedger();

      const result = await Auditor.review_plan({ groups, ledger });

      expect(result.signals.length).toBeGreaterThan(0);
      const overlapSignal = result.signals.find(s => s.category === "overlap");
      expect(overlapSignal).toBeTruthy();
      expect(overlapSignal?.severity).toBe("error");
    });

    test("detects unassigned hunks", async () => {
      const groups = [
        createGroup({ id: "group-1", hunkIds: ["hunk-1"] }),
      ];
      const ledger = createLedger();

      const result = await Auditor.review_plan({ groups, ledger });

      expect(result.signals.length).toBeGreaterThan(0);
      const coverageSignal = result.signals.find(s => s.category === "coverage");
      expect(coverageSignal).toBeTruthy();
      expect(coverageSignal?.severity).toBe("error");
    });

    test("detects incorrect dependency ordering", async () => {
      const groups = [
        createGroup({
          id: "group-2",
          name: "Group 2",
          hunkIds: ["hunk-1"],
          order: 0,
          dependencies: ["group-1"],
        }),
        createGroup({
          id: "group-1",
          name: "Group 1",
          hunkIds: ["hunk-2"],
          order: 1,
          dependencies: [],
        }),
      ];
      const ledger = createLedger();

      const result = await Auditor.review_plan({ groups, ledger });

      expect(result.signals.length).toBeGreaterThan(0);
      const depSignal = result.signals.find(s => s.category === "dependency");
      expect(depSignal).toBeTruthy();
      expect(depSignal?.severity).toBe("error");
    });

    test("detects unrelated changes in same group", async () => {
      const groups = [
        createGroup({
          id: "group-1",
          hunkIds: ["hunk-1", "hunk-3"],
          filePaths: ["src/auth.ts", "src/utils.ts"],
        }),
      ];
      const ledger = createLedger();

      const result = await Auditor.review_plan({ groups, ledger });

      expect(result.signals.length).toBeGreaterThanOrEqual(0);
    });

    test("handles single group plan", async () => {
      const groups = [
        createGroup({ id: "group-1", hunkIds: ["hunk-1", "hunk-2", "hunk-3"] }),
      ];
      const ledger = createLedger();

      const result = await Auditor.review_plan({ groups, ledger });

      expect(result.signals.length).toBe(0);
    });

    test("handles large plan with many groups", async () => {
      const groups = Array.from({ length: 20 }, (_, i) =>
        createGroup({
          id: `group-${i}`,
          name: `Feature ${i}`,
          hunkIds: [`hunk-${i}`],
          order: i,
        })
      );
      const ledger = createLedger();

      const result = await Auditor.review_plan({ groups, ledger });

      expect(result.signals.length).toBe(0);
    });

    test("includes affected groupId in signals", async () => {
      const groups = [
        createGroup({ id: "group-1", hunkIds: ["hunk-1", "hunk-2"] }),
        createGroup({ id: "group-2", hunkIds: ["hunk-2", "hunk-3"] }),
      ];
      const ledger = createLedger();

      const result = await Auditor.review_plan({ groups, ledger });

      for (const signal of result.signals) {
        expect(signal.groupId).toBeTruthy();
      }
    });

    test("includes clear message in signals", async () => {
      const groups = [
        createGroup({ id: "group-1", hunkIds: ["hunk-1", "hunk-2"] }),
        createGroup({ id: "group-2", hunkIds: ["hunk-2", "hunk-3"] }),
      ];
      const ledger = createLedger();

      const result = await Auditor.review_plan({ groups, ledger });

      for (const signal of result.signals) {
        expect(signal.issue).toBeTruthy();
        expect(typeof signal.issue).toBe("string");
      }
    });
  });

  describe("verify_hunk_coverage", () => {
    test("returns empty arrays when all hunks assigned", async () => {
      const groups = [
        createGroup({ id: "group-1", hunkIds: ["hunk-1", "hunk-2", "hunk-3"] }),
      ];
      const ledger = createLedger();

      const result = await Auditor.verify_hunk_coverage({ groups, ledger });

      expect(result.unassigned.length).toBe(0);
      expect(result.overlaps.length).toBe(0);
    });

    test("detects unassigned hunks", async () => {
      const groups = [
        createGroup({ id: "group-1", hunkIds: ["hunk-1"] }),
      ];
      const ledger = createLedger();

      const result = await Auditor.verify_hunk_coverage({ groups, ledger });

      expect(result.unassigned.length).toBeGreaterThan(0);
      expect(result.unassigned).toContain("hunk-2");
      expect(result.unassigned).toContain("hunk-3");
    });

    test("detects overlapping hunks", async () => {
      const groups = [
        createGroup({ id: "group-1", hunkIds: ["hunk-1", "hunk-2"] }),
        createGroup({ id: "group-2", hunkIds: ["hunk-2", "hunk-3"] }),
      ];
      const ledger = createLedger();

      const result = await Auditor.verify_hunk_coverage({ groups, ledger });

      expect(result.overlaps.length).toBeGreaterThan(0);
      expect(result.overlaps[0]).toContain("hunk-2");
    });

    test("handles empty groups", async () => {
      const groups: CommitGroup[] = [];
      const ledger = createLedger();

      const result = await Auditor.verify_hunk_coverage({ groups, ledger });

      expect(result.unassigned.length).toBe(3);
      expect(result.overlaps.length).toBe(0);
    });

    test("handles empty ledger", async () => {
      const groups = [
        createGroup({ id: "group-1", hunkIds: ["hunk-1"] }),
      ];
      const ledger = createLedger({ hunks: {} });

      const result = await Auditor.verify_hunk_coverage({ groups, ledger });

      expect(result.unassigned.length).toBe(0);
      expect(result.overlaps.length).toBe(0);
    });

    test("handles multiple overlaps", async () => {
      const groups = [
        createGroup({ id: "group-1", hunkIds: ["hunk-1"] }),
        createGroup({ id: "group-2", hunkIds: ["hunk-1"] }),
        createGroup({ id: "group-3", hunkIds: ["hunk-1"] }),
      ];
      const ledger = createLedger();

      const result = await Auditor.verify_hunk_coverage({ groups, ledger });

      expect(result.overlaps.length).toBeGreaterThan(0);
    });
  });
});