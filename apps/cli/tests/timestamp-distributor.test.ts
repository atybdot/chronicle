import { describe, test, expect } from "bun:test";
import { TimestampDistributor } from "../src/lib/agents/timestamp-distributor";
import type { CommitGroup, CommitMessage } from "../src/types";

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

function createMessage(overrides: Partial<CommitMessage> = {}): CommitMessage {
  return {
    groupId: "group-1",
    subject: "feat: add user authentication",
    ...overrides,
  };
}

describe("TimestampDistributor", () => {
  describe("distribute_timestamps", () => {
    test("assigns timestamps within date range", async () => {
      const groups = [
        createGroup({ id: "group-1" }),
        createGroup({ id: "group-2", name: "Add logout" }),
      ];
      const messages = [
        createMessage({ groupId: "group-1" }),
        createMessage({ groupId: "group-2", subject: "feat: add logout" }),
      ];

      const result = await TimestampDistributor.distribute_timestamps(
        groups,
        messages,
        "feature development",
        {
          start: "2024-01-15T09:00:00Z",
          end: "2024-01-19T18:00:00Z",
        }
      );

      expect(result.timestamps.length).toBe(2);
      
      const startDate = new Date("2024-01-15T09:00:00Z").getTime();
      const endDate = new Date("2024-01-19T18:00:00Z").getTime();
      
      for (const ts of result.timestamps) {
        const tsDate = new Date(ts.commitDate).getTime();
        expect(tsDate).toBeGreaterThanOrEqual(startDate);
        expect(tsDate).toBeLessThanOrEqual(endDate);
      }
    });

    test("clusters commits in same group close together", async () => {
      const groups = [
        createGroup({ id: "group-1", hunkIds: ["hunk-1", "hunk-2", "hunk-3"] }),
      ];
      const messages = [
        createMessage({ groupId: "group-1" }),
      ];

      const result = await TimestampDistributor.distribute_timestamps(
        groups,
        messages,
        "feature development",
        {
          start: "2024-01-15T09:00:00Z",
          end: "2024-01-19T18:00:00Z",
        }
      );

      expect(result.timestamps.length).toBe(1);
      expect(result.timestamps[0]?.groupId).toBe("group-1");
    });

    test("assigns session IDs to group commits", async () => {
      const groups = [
        createGroup({ id: "group-1" }),
        createGroup({ id: "group-2" }),
      ];
      const messages = [
        createMessage({ groupId: "group-1" }),
        createMessage({ groupId: "group-2" }),
      ];

      const result = await TimestampDistributor.distribute_timestamps(
        groups,
        messages,
        "feature development",
        {
          start: "2024-01-15T09:00:00Z",
          end: "2024-01-19T18:00:00Z",
        }
      );

      for (const ts of result.timestamps) {
        expect(ts.sessionId).toBeTruthy();
        expect(typeof ts.sessionId).toBe("string");
      }
    });

    test("handles single day range", async () => {
      const groups = [createGroup({ id: "group-1" })];
      const messages = [createMessage({ groupId: "group-1" })];

      const result = await TimestampDistributor.distribute_timestamps(
        groups,
        messages,
        "bug fix",
        {
          start: "2024-01-15T09:00:00Z",
          end: "2024-01-15T18:00:00Z",
        }
      );

      expect(result.timestamps.length).toBe(1);
      const tsDate = new Date(result.timestamps[0]?.commitDate ?? "");
      expect(tsDate.getUTCDate()).toBe(15);
    });

    test("handles month-long range", async () => {
      const groups = Array.from({ length: 10 }, (_, i) =>
        createGroup({ id: `group-${i}`, name: `Feature ${i}` })
      );
      const messages = groups.map((g) =>
        createMessage({ groupId: g.id, subject: `feat: feature ${g.id.split("-")[1]}` })
      );

      const result = await TimestampDistributor.distribute_timestamps(
        groups,
        messages,
        "feature development",
        {
          start: "2024-01-01T09:00:00Z",
          end: "2024-01-31T18:00:00Z",
        }
      );

      expect(result.timestamps.length).toBe(10);
      
      const startDate = new Date("2024-01-01T09:00:00Z").getTime();
      const endDate = new Date("2024-01-31T18:00:00Z").getTime();
      
      for (const ts of result.timestamps) {
        const tsDate = new Date(ts.commitDate).getTime();
        expect(tsDate).toBeGreaterThanOrEqual(startDate);
        expect(tsDate).toBeLessThanOrEqual(endDate);
      }
    });

    test("compresses spacing when range is too small", async () => {
      const groups = Array.from({ length: 5 }, (_, i) =>
        createGroup({ id: `group-${i}`, name: `Feature ${i}` })
      );
      const messages = groups.map((g) =>
        createMessage({ groupId: g.id, subject: `feat: feature ${g.id.split("-")[1]}` })
      );

      const result = await TimestampDistributor.distribute_timestamps(
        groups,
        messages,
        "feature development",
        {
          start: "2024-01-15T12:00:00Z",
          end: "2024-01-15T12:30:00Z",
        }
      );

      expect(result.timestamps.length).toBe(5);
      
      const startDate = new Date("2024-01-15T12:00:00Z").getTime();
      const endDate = new Date("2024-01-15T12:30:00Z").getTime();
      
      for (const ts of result.timestamps) {
        const tsDate = new Date(ts.commitDate).getTime();
        expect(tsDate).toBeGreaterThanOrEqual(startDate);
        expect(tsDate).toBeLessThanOrEqual(endDate);
      }
    });

    test("respects working hours for weekday commits", async () => {
      const groups = [createGroup({ id: "group-1" })];
      const messages = [createMessage({ groupId: "group-1" })];

      const result = await TimestampDistributor.distribute_timestamps(
        groups,
        messages,
        "feature development",
        {
          start: "2024-01-15T00:00:00Z",
          end: "2024-01-15T23:59:59Z",
        }
      );

      const tsDate = new Date(result.timestamps[0]?.commitDate ?? "");
      const hour = tsDate.getUTCHours();
      
      expect(hour).toBeGreaterThanOrEqual(9);
      expect(hour).toBeLessThan(18);
    });

    test("avoids weekend commits for feature development", async () => {
      const groups = Array.from({ length: 5 }, (_, i) =>
        createGroup({ id: `group-${i}`, name: `Feature ${i}` })
      );
      const messages = groups.map((g) =>
        createMessage({ groupId: g.id, subject: `feat: feature ${g.id.split("-")[1]}` })
      );

      const result = await TimestampDistributor.distribute_timestamps(
        groups,
        messages,
        "feature development",
        {
          start: "2024-01-12T09:00:00Z",
          end: "2024-01-15T18:00:00Z",
        }
      );

      for (const ts of result.timestamps) {
        const tsDate = new Date(ts.commitDate);
        const day = tsDate.getUTCDay();
        expect(day).not.toBe(0);
        expect(day).not.toBe(6);
      }
    });

    test("allows weekend commits when intent indicates", async () => {
      const groups = [createGroup({ id: "group-1" })];
      const messages = [createMessage({ groupId: "group-1" })];

      const result = await TimestampDistributor.distribute_timestamps(
        groups,
        messages,
        "weekend cleanup",
        {
          start: "2024-01-13T09:00:00Z",
          end: "2024-01-14T18:00:00Z",
        }
      );

      expect(result.timestamps.length).toBe(1);
      const tsDate = new Date(result.timestamps[0]?.commitDate ?? "");
      const day = tsDate.getUTCDay();
      
      expect(day === 0 || day === 6).toBe(true);
    });

    test("handles empty groups array", async () => {
      const result = await TimestampDistributor.distribute_timestamps(
        [],
        [],
        "feature development",
        {
          start: "2024-01-15T09:00:00Z",
          end: "2024-01-19T18:00:00Z",
        }
      );

      expect(result.timestamps.length).toBe(0);
    });

    test("includes timezone offset in assignments", async () => {
      const groups = [createGroup({ id: "group-1" })];
      const messages = [createMessage({ groupId: "group-1" })];

      const result = await TimestampDistributor.distribute_timestamps(
        groups,
        messages,
        "feature development",
        {
          start: "2024-01-15T09:00:00Z",
          end: "2024-01-19T18:00:00Z",
        }
      );

      const ts = result.timestamps[0];
      expect(ts?.commitDateTz).toBeTruthy();
      expect(ts?.authorDateTz).toBeTruthy();
      expect(ts?.commitDateTz).toMatch(/^[+-]\d{2}:\d{2}$/);
      expect(ts?.authorDateTz).toMatch(/^[+-]\d{2}:\d{2}$/);
    });
  });

  describe("analyze_temporal_patterns", () => {
    test("suggests business hours for feature development", async () => {
      const result = await TimestampDistributor.analyze_temporal_patterns(
        {
          start: "2024-01-15T09:00:00Z",
          end: "2024-01-19T18:00:00Z",
        },
        "feature development"
      );

      expect(result.suggestedWorkHours.start).toBe(9);
      expect(result.suggestedWorkHours.end).toBe(18);
      expect(result.excludeWeekends).toBe(true);
    });

    test("suggests spread evenly for cleanup", async () => {
      const result = await TimestampDistributor.analyze_temporal_patterns(
        {
          start: "2024-01-15T09:00:00Z",
          end: "2024-01-19T18:00:00Z",
        },
        "cleanup"
      );

      expect(result.excludeWeekends).toBe(false);
    });

    test("suggests clustering for bug fixes", async () => {
      const result = await TimestampDistributor.analyze_temporal_patterns(
        {
          start: "2024-01-15T09:00:00Z",
          end: "2024-01-19T18:00:00Z",
        },
        "bug fix"
      );

      expect(result.clusterCommits).toBe(true);
    });

    test("handles single day range", async () => {
      const result = await TimestampDistributor.analyze_temporal_patterns(
        {
          start: "2024-01-15T09:00:00Z",
          end: "2024-01-15T18:00:00Z",
        },
        "feature development"
      );

      expect(result.suggestedWorkHours.start).toBeGreaterThanOrEqual(9);
      expect(result.suggestedWorkHours.end).toBeLessThanOrEqual(18);
    });

    test("handles month-long range", async () => {
      const result = await TimestampDistributor.analyze_temporal_patterns(
        {
          start: "2024-01-01T09:00:00Z",
          end: "2024-01-31T18:00:00Z",
        },
        "feature development"
      );

      expect(result.suggestedWorkHours.start).toBe(9);
      expect(result.suggestedWorkHours.end).toBe(18);
    });
  });
});