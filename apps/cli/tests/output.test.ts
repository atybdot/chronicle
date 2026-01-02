import { describe, expect, test } from "bun:test";
import {
  renderCommitGraph,
  renderPlanSummary,
  exportPlanAsJson,
} from "../src/lib/output";
import type { PlannedCommit, CommitPlan } from "../src/types";

describe("Output utilities", () => {
  const sampleCommits: PlannedCommit[] = [
    {
      id: "1",
      message: "feat: add feature",
      files: [{ path: "src/feature.ts", status: "added" }],
      category: "feature",
      scheduledDate: new Date("2024-01-15T10:00:00Z"),
    },
    {
      id: "2",
      message: "fix: bug fix",
      files: [{ path: "src/bug.ts", status: "modified" }],
      category: "fix",
      scheduledDate: new Date("2024-01-15T14:00:00Z"),
    },
  ];

  const samplePlan: CommitPlan = {
    commits: sampleCommits,
    dateRange: {
      start: new Date("2024-01-15"),
      end: new Date("2024-01-20"),
    },
    strategy: "realistic",
    totalFiles: 2,
    estimatedDuration: "5 days",
  };

  test("renderCommitGraph produces output", () => {
    const output = renderCommitGraph(sampleCommits);

    expect(output).toContain("Commit Graph Preview");
    expect(output).toContain("feat: add feature");
    expect(output).toContain("fix: bug fix");
  });

  test("renderPlanSummary produces output", () => {
    const output = renderPlanSummary(samplePlan);

    expect(output).toContain("Commit Plan Summary");
    expect(output).toContain("Total commits:");
    expect(output).toContain("Total files:");
  });

  test("exportPlanAsJson produces valid JSON", () => {
    const json = exportPlanAsJson(samplePlan);
    const parsed = JSON.parse(json);

    expect(parsed.commits.length).toBe(2);
    expect(parsed.strategy).toBe("realistic");
    expect(parsed.totalFiles).toBe(2);
  });

  test("exportPlanAsJson converts dates to ISO strings", () => {
    const json = exportPlanAsJson(samplePlan);
    const parsed = JSON.parse(json);

    expect(parsed.dateRange.start).toBe("2024-01-15T00:00:00.000Z");
    expect(parsed.commits[0].scheduledDate).toBe("2024-01-15T10:00:00.000Z");
  });
});
