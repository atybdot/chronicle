import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { PlanCache } from "../src/lib/cache";
import type { AgentCommitPlan, ExecutionState } from "../src/types";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

let tempDir: string;
let originalEnv: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "plan-cache-test-"));
  originalEnv = process.env.CHRONICLE_CACHE_DIR;
  process.env.CHRONICLE_CACHE_DIR = tempDir;
});

afterEach(async () => {
  if (originalEnv !== undefined) {
    process.env.CHRONICLE_CACHE_DIR = originalEnv;
  } else {
    delete process.env.CHRONICLE_CACHE_DIR;
  }
  await rm(tempDir, { recursive: true, force: true });
});

function createPlan(overrides: Partial<AgentCommitPlan> = {}): AgentCommitPlan {
  return {
    planHash: "test-hash-123",
    groups: [],
    messages: [],
    timestampAssignments: [],
    auditSignals: [],
    version: 1,
    ...overrides,
  };
}

function createExecutionState(overrides: Partial<ExecutionState> = {}): ExecutionState {
  return {
    planHash: "test-hash-123",
    completedGroups: [],
    failedGroups: [],
    ledger: {
      gitDiffHash: "abc123",
      configHash: "def456",
      hunks: {},
      newFiles: {},
      commits: {},
      ledgerVersion: 1,
    },
    ...overrides,
  };
}

describe("PlanCache", () => {
  describe("computePlanHash", () => {
    test("produces consistent hashes for same inputs", () => {
      const config = {
        llm: { selected: { provider: "openrouter" as const }, providers: [] },
        git: {},
        defaults: {
          distribution: "realistic" as const,
          dryRun: true,
          workHoursStart: 9,
          workHoursEnd: 18,
          excludeWeekends: false,
        },
      };
      const hash1 = PlanCache.computePlanHash(
        "diff-content",
        config,
        "intent",
        ["hunk-1", "hunk-2"]
      );
      const hash2 = PlanCache.computePlanHash(
        "diff-content",
        config,
        "intent",
        ["hunk-1", "hunk-2"]
      );

      expect(hash1).toBe(hash2);
    });

    test("produces different hashes when diff changes", () => {
      const config = {
        llm: { selected: { provider: "openrouter" as const }, providers: [] },
        git: {},
        defaults: {
          distribution: "realistic" as const,
          dryRun: true,
          workHoursStart: 9,
          workHoursEnd: 18,
          excludeWeekends: false,
        },
      };
      const hash1 = PlanCache.computePlanHash(
        "diff-content-1",
        config,
        "intent",
        []
      );
      const hash2 = PlanCache.computePlanHash(
        "diff-content-2",
        config,
        "intent",
        []
      );

      expect(hash1).not.toBe(hash2);
    });

    test("produces different hashes when intent changes", () => {
      const config = {
        llm: { selected: { provider: "openrouter" as const }, providers: [] },
        git: {},
        defaults: {
          distribution: "realistic" as const,
          dryRun: true,
          workHoursStart: 9,
          workHoursEnd: 18,
          excludeWeekends: false,
        },
      };
      const hash1 = PlanCache.computePlanHash(
        "diff-content",
        config,
        "intent-1",
        []
      );
      const hash2 = PlanCache.computePlanHash(
        "diff-content",
        config,
        "intent-2",
        []
      );

      expect(hash1).not.toBe(hash2);
    });

    test("produces different hashes when committed hunks change", () => {
      const config = {
        llm: { selected: { provider: "openrouter" as const }, providers: [] },
        git: {},
        defaults: {
          distribution: "realistic" as const,
          dryRun: true,
          workHoursStart: 9,
          workHoursEnd: 18,
          excludeWeekends: false,
        },
      };
      const hash1 = PlanCache.computePlanHash(
        "diff-content",
        config,
        "intent",
        ["hunk-1"]
      );
      const hash2 = PlanCache.computePlanHash(
        "diff-content",
        config,
        "intent",
        ["hunk-1", "hunk-2"]
      );

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("getCachedPlan", () => {
    test("returns null for cache miss", async () => {
      const result = await PlanCache.getCachedPlan("nonexistent-hash");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });
  });

  describe("writePlanCache and getCachedPlan", () => {
    test("writes and reads plan", async () => {
      const plan = createPlan({ planHash: "test-hash" });

      const writeResult = await PlanCache.writePlanCache(plan, "test-hash");
      expect(writeResult.ok).toBe(true);

      const readResult = await PlanCache.getCachedPlan("test-hash");
      expect(readResult.ok).toBe(true);
      if (readResult.ok) {
        expect(readResult.value).toBeTruthy();
        expect(readResult.value?.planHash).toBe("test-hash");
      }
    });

    test("overwrites existing cache for same hash", async () => {
      const plan1 = createPlan({ planHash: "test-hash" });
      const plan2 = createPlan({ planHash: "test-hash" });

      await PlanCache.writePlanCache(plan1, "test-hash");
      const writeResult = await PlanCache.writePlanCache(plan2, "test-hash");
      expect(writeResult.ok).toBe(true);

      const readResult = await PlanCache.getCachedPlan("test-hash");
      expect(readResult.ok).toBe(true);
    });
  });

  describe("updateExecutionState and getExecutionState", () => {
    test("stores and reads execution state", async () => {
      const state = createExecutionState({ planHash: "test-hash" });

      const writeResult = await PlanCache.updateExecutionState("test-hash", state);
      expect(writeResult.ok).toBe(true);

      const readResult = await PlanCache.getExecutionState("test-hash");
      expect(readResult.ok).toBe(true);
      if (readResult.ok) {
        expect(readResult.value).toBeTruthy();
        expect(readResult.value?.planHash).toBe("test-hash");
      }
    });

    test("returns null for missing state", async () => {
      const result = await PlanCache.getExecutionState("nonexistent-hash");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });
  });

  describe("invalidateCache", () => {
    test("deletes both plan and state files", async () => {
      const plan = createPlan({ planHash: "test-hash" });
      const state = createExecutionState({ planHash: "test-hash" });

      await PlanCache.writePlanCache(plan, "test-hash");
      await PlanCache.updateExecutionState("test-hash", state);

      const invalidateResult = await PlanCache.invalidateCache("test-hash");
      expect(invalidateResult.ok).toBe(true);

      const readResult = await PlanCache.getCachedPlan("test-hash");
      expect(readResult.ok).toBe(true);
      if (readResult.ok) {
        expect(readResult.value).toBeNull();
      }
    });
  });

  describe("invalidateAllCaches", () => {
    test("clears the entire cache directory", async () => {
      const plan1 = createPlan({ planHash: "hash-1" });
      const plan2 = createPlan({ planHash: "hash-2" });

      await PlanCache.writePlanCache(plan1, "hash-1");
      await PlanCache.writePlanCache(plan2, "hash-2");

      const invalidateResult = await PlanCache.invalidateAllCaches();
      expect(invalidateResult.ok).toBe(true);

      const readResult1 = await PlanCache.getCachedPlan("hash-1");
      const readResult2 = await PlanCache.getCachedPlan("hash-2");
      
      if (readResult1.ok) expect(readResult1.value).toBeNull();
      if (readResult2.ok) expect(readResult2.value).toBeNull();
    });
  });

  describe("listCachedPlans", () => {
    test("returns all cached plan hashes", async () => {
      const plan1 = createPlan({ planHash: "hash-1" });
      const plan2 = createPlan({ planHash: "hash-2" });

      await PlanCache.writePlanCache(plan1, "hash-1");
      await PlanCache.writePlanCache(plan2, "hash-2");

      const listResult = await PlanCache.listCachedPlans();
      expect(listResult.ok).toBe(true);
      if (listResult.ok) {
        expect(listResult.value.length).toBe(2);
        expect(listResult.value).toContain("hash-1");
        expect(listResult.value).toContain("hash-2");
      }
    });

    test("returns empty array when no caches exist", async () => {
      const listResult = await PlanCache.listCachedPlans();
      expect(listResult.ok).toBe(true);
      if (listResult.ok) {
        expect(listResult.value.length).toBe(0);
      }
    });
  });

  describe("edge cases", () => {
    test("returns error for corrupted cache file", async () => {
      const fs = await import("fs");
      const cacheDir = join(tempDir, "plans");
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(join(cacheDir, "corrupted-hash.json"), "not valid json {{{");

      const result = await PlanCache.getCachedPlan("corrupted-hash");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("Failed to read cached plan");
      }
    });

    test("handles very large plan with 100+ groups", async () => {
      const groups = Array.from({ length: 120 }, (_, i) => ({
        id: `group-${i}`,
        name: `Group ${i}`,
        description: `Description for group ${i}`,
        hunkIds: [`hunk-${i}`],
        filePaths: [`src/file-${i}.ts`],
        category: "chore" as const,
        order: i,
        dependencies: [],
      }));

      const plan = createPlan({ planHash: "large-plan", groups });
      const writeResult = await PlanCache.writePlanCache(plan, "large-plan");
      expect(writeResult.ok).toBe(true);

      const readResult = await PlanCache.getCachedPlan("large-plan");
      expect(readResult.ok).toBe(true);
      if (readResult.ok) {
        expect(readResult.value?.groups.length).toBe(120);
      }
    });
  });
});
