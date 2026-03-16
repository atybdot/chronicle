import { describe, expect, test } from "bun:test";
import {
  distributeCommits,
  suggestDaysForCommits,
  getDistributionStats,
} from "../src/lib/distribution";
import type { PlannedCommit } from "../src/types";

describe("Distribution utilities", () => {
  test("suggestDaysForCommits calculates correct days", () => {
    expect(suggestDaysForCommits(4)).toBe(1);
    expect(suggestDaysForCommits(8)).toBe(2);
    expect(suggestDaysForCommits(20)).toBe(5);
    expect(suggestDaysForCommits(1)).toBe(1);
  });

  test("suggestDaysForCommits respects custom avgCommitsPerDay", () => {
    expect(suggestDaysForCommits(10, 5)).toBe(2);
    expect(suggestDaysForCommits(10, 2)).toBe(5);
  });

  test("getDistributionStats returns correct stats", () => {
    const commits: PlannedCommit[] = [
      {
        id: "1",
        message: "feat: add feature",
        files: [],
        category: "feature",
        scheduledDate: new Date("2024-01-15T10:00:00Z"),
      },
      {
        id: "2",
        message: "fix: bug fix",
        files: [],
        category: "fix",
        scheduledDate: new Date("2024-01-15T14:00:00Z"),
      },
      {
        id: "3",
        message: "docs: update readme",
        files: [],
        category: "docs",
        scheduledDate: new Date("2024-01-16T10:00:00Z"),
      },
    ];

    const stats = getDistributionStats(commits);

    expect(stats.totalCommits).toBe(3);
    expect(stats.totalDays).toBe(2);
    expect(stats.avgPerDay).toBe(1.5);
  });

  test("getDistributionStats handles empty commits", () => {
    const stats = getDistributionStats([]);

    expect(stats.totalCommits).toBe(0);
    expect(stats.totalDays).toBe(0);
    expect(stats.avgPerDay).toBe(0);
  });

  test("getDistributionStats calculates byDayOfWeek correctly", () => {
    // Monday, Jan 15, 2024
    const commits: PlannedCommit[] = [
      {
        id: "1",
        message: "test",
        files: [],
        category: "feature",
        scheduledDate: new Date("2024-01-15T10:00:00Z"), // Monday
      },
      {
        id: "2",
        message: "test",
        files: [],
        category: "feature",
        scheduledDate: new Date("2024-01-16T10:00:00Z"), // Tuesday
      },
      {
        id: "3",
        message: "test",
        files: [],
        category: "feature",
        scheduledDate: new Date("2024-01-17T10:00:00Z"), // Wednesday
      },
    ];

    const stats = getDistributionStats(commits);

    expect(stats.byDayOfWeek["Monday"]).toBe(1);
    expect(stats.byDayOfWeek["Tuesday"]).toBe(1);
    expect(stats.byDayOfWeek["Wednesday"]).toBe(1);
  });

  test("distributeCommits spreads realistic plans across one day per commit when range is long enough", async () => {
    const commits: PlannedCommit[] = Array.from({ length: 6 }, (_, index) => ({
      id: `${index + 1}`,
      message: `chore: commit ${index + 1}`,
      files: [],
      category: "chore",
    }));

    const distributed = await distributeCommits(
      commits,
      { start: new Date("2024-01-01T00:00:00Z"), end: new Date("2024-01-20T00:00:00Z") },
      { strategy: "realistic", excludeWeekends: false, workHoursStart: 9, workHoursEnd: 18 },
    );

    const stats = getDistributionStats(distributed);
    expect(stats.totalDays).toBe(6);
    expect(Object.keys(stats.byDayOfWeek).length).toBeGreaterThan(3);
  });
});
