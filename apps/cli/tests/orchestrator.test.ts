import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Orchestrator } from "../src/lib/agents/orchestrator";
import { PlanCache } from "../src/lib/cache";
import { $ } from "bun";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

let tempDir: string;
let originalChronicleConfigDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "orchestrator-test-"));
  originalChronicleConfigDir = process.env.CHRONICLE_CONFIG_DIR;
  process.env.CHRONICLE_CONFIG_DIR = tempDir;
  await $`git init`.cwd(tempDir);
  await $`git config user.email "test@test.com"`.cwd(tempDir);
  await $`git config user.name "Test User"`.cwd(tempDir);
});

afterEach(async () => {
  if (originalChronicleConfigDir !== undefined) {
    process.env.CHRONICLE_CONFIG_DIR = originalChronicleConfigDir;
  } else {
    delete process.env.CHRONICLE_CONFIG_DIR;
  }
  await rm(tempDir, { recursive: true, force: true });
});

async function createConfig(config: Record<string, unknown> = {}): Promise<void> {
  await writeFile(
    join(tempDir, "config.json"),
    JSON.stringify(config, null, 2)
  );
}

async function createInitialCommit(): Promise<void> {
  await writeFile(join(tempDir, "file1.txt"), "initial content");
  await $`git add .`.cwd(tempDir);
  await $`git commit -m "initial"`.cwd(tempDir);
}

async function createChanges(): Promise<void> {
  await writeFile(join(tempDir, "file1.txt"), "modified content");
  await writeFile(join(tempDir, "file2.txt"), "new file content");
}

describe("Orchestrator", () => {
  describe("runAnalysisPhase", () => {
    test("returns error when not a git repo", async () => {
      const result = await Orchestrator.runAnalysisPhase({
        repoRoot: "/tmp/not-a-repo",
      });

      expect(result.ok).toBe(false);
    });

    test("returns early when no uncommitted changes", async () => {
      await createInitialCommit();
      await createConfig();

      const result = await Orchestrator.runAnalysisPhase({
        repoRoot: tempDir,
      });

      // Log the result for debugging
      if (!result.ok) {
        console.error("runAnalysisPhase failed:", result.error);
      }

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.groups.length).toBe(0);
      }
    });

    test("returns success with defaults when config is missing", async () => {
      await createInitialCommit();
      await createChanges();
      // No config file

      const result = await Orchestrator.runAnalysisPhase({
        repoRoot: tempDir,
      });

      // Should succeed with defaults
      expect(result.ok).toBe(true);
    });

    test("processes changes through full pipeline", async () => {
      await createInitialCommit();
      await createChanges();
      await createConfig({
        llm: { selected: { provider: "openrouter" } },
        defaults: {
          messageStyle: "conventional",
          intent: "feature development",
          dateRange: {
            start: "2024-01-15T09:00:00Z",
            end: "2024-01-19T18:00:00Z",
          },
        },
      });

      const result = await Orchestrator.runAnalysisPhase({
        repoRoot: tempDir,
      });

      // Log the result for debugging
      if (!result.ok) {
        console.error("runAnalysisPhase failed:", result.error);
      }

      // Should succeed and have groups
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.groups.length).toBeGreaterThan(0);
        expect(result.value.timestampAssignments.length).toBeGreaterThan(0);
      }
    });

    test("filters already-committed hunks", async () => {
      await createInitialCommit();
      
      // Make and commit some changes
      await writeFile(join(tempDir, "file1.txt"), "first change");
      await $`git add .`.cwd(tempDir);
      await $`git commit -m "first change"`.cwd(tempDir);
      
      // Make more changes
      await writeFile(join(tempDir, "file1.txt"), "second change");
      await writeFile(join(tempDir, "file2.txt"), "new file");
      
      await createConfig({
        llm: { selected: { provider: "openrouter" } },
        defaults: {
          messageStyle: "conventional",
          intent: "feature development",
        },
      });

      const result = await Orchestrator.runAnalysisPhase({
        repoRoot: tempDir,
      });

      expect(result.ok).toBe(true);
    });

    test("uses configured model for each agent", async () => {
      await createInitialCommit();
      await createChanges();
      await createConfig({
        llm: {
          selected: { provider: "openrouter" },
          agentRoles: {
            orchestrator: { provider: "openrouter", model: "claude-sonnet-4" },
            "file-analyzer": { provider: "ollama", model: "llama3.2" },
          },
        },
        defaults: {
          messageStyle: "conventional",
          intent: "feature development",
        },
      });

      const result = await Orchestrator.runAnalysisPhase({
        repoRoot: tempDir,
      });

      // Should still work with custom model config
      expect(result.ok).toBe(true);
    });

    test("returns complete plan with all fields", async () => {
      await createInitialCommit();
      await createChanges();
      await createConfig({
        llm: { selected: { provider: "openrouter" } },
        defaults: {
          messageStyle: "conventional",
          intent: "feature development",
          dateRange: {
            start: "2024-01-15T09:00:00Z",
            end: "2024-01-19T18:00:00Z",
          },
        },
      });

      const result = await Orchestrator.runAnalysisPhase({
        repoRoot: tempDir,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const plan = result.value;
        expect(plan.groups).toBeDefined();
        expect(plan.messages).toBeDefined();
        expect(plan.timestampAssignments).toBeDefined();
        expect(plan.auditSignals).toBeDefined();
      }
    });
  });

  describe("runAuditPhase", () => {
    test("returns empty signals for valid plan", async () => {
      await createInitialCommit();
      await createChanges();
      await createConfig({
        llm: { selected: { provider: "openrouter" } },
        defaults: {
          messageStyle: "conventional",
          intent: "feature development",
          dateRange: {
            start: "2024-01-15T09:00:00Z",
            end: "2024-01-19T18:00:00Z",
          },
        },
      });

      const analysisResult = await Orchestrator.runAnalysisPhase({
        repoRoot: tempDir,
      });

      expect(analysisResult.ok).toBe(true);
      if (analysisResult.ok) {
        // Create a proper AgentCommitPlan from analysis result
        const plan = {
          planHash: "test-hash",
          groups: analysisResult.value.groups,
          messages: analysisResult.value.messages,
          timestampAssignments: analysisResult.value.timestampAssignments,
          auditSignals: analysisResult.value.auditSignals,
          version: 1 as const,
        };
        const auditResult = await Orchestrator.runAuditPhase({
          plan,
          repoRoot: tempDir,
        });

        expect(auditResult.ok).toBe(true);
        if (auditResult.ok) {
          expect(auditResult.value.signals.length).toBe(0);
        }
      }
    });

    test("detects issues in plan", async () => {
      await createInitialCommit();
      await createChanges();
      await createConfig({
        llm: { selected: { provider: "openrouter" } },
        defaults: {
          messageStyle: "conventional",
          intent: "feature development",
          dateRange: {
            start: "2024-01-15T09:00:00Z",
            end: "2024-01-19T18:00:00Z",
          },
        },
      });

      const analysisResult = await Orchestrator.runAnalysisPhase({
        repoRoot: tempDir,
      });

      expect(analysisResult.ok).toBe(true);
      if (analysisResult.ok) {
        // Create a proper AgentCommitPlan from analysis result
        const basePlan = {
          planHash: "test-hash",
          groups: analysisResult.value.groups.map(g => ({
            id: g.id,
            name: g.name ?? "default",
            description: g.description ?? "default",
            hunkIds: g.hunkIds,
            filePaths: g.filePaths ?? [],
            category: g.category ?? "chore" as const,
            order: g.order ?? 0,
            dependencies: g.dependencies ?? [],
          })),
          messages: analysisResult.value.messages ?? [],
          timestampAssignments: analysisResult.value.timestampAssignments,
          auditSignals: analysisResult.value.auditSignals,
          version: 1 as const,
        };

        // Modify plan to have overlapping hunks
        const firstGroup = basePlan.groups[0];
        if (!firstGroup) throw new Error("No groups in plan");
        const modifiedPlan = {
          ...basePlan,
          groups: [
            ...basePlan.groups,
            {
              id: "duplicate-group",
              name: firstGroup.name,
              description: firstGroup.description,
              hunkIds: [...firstGroup.hunkIds],
              filePaths: [...firstGroup.filePaths],
              category: firstGroup.category,
              order: firstGroup.order,
              dependencies: [...firstGroup.dependencies],
            },
          ],
        };

        const auditResult = await Orchestrator.runAuditPhase({
          plan: modifiedPlan,
          repoRoot: tempDir,
        });

        expect(auditResult.ok).toBe(true);
        if (auditResult.ok) {
          expect(auditResult.value.signals.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe("runFullPipeline", () => {
    test("runs analysis and audit phases together", async () => {
      await createInitialCommit();
      await createChanges();
      await createConfig({
        llm: { selected: { provider: "openrouter" } },
        defaults: {
          messageStyle: "conventional",
          intent: "feature development",
          dateRange: {
            start: "2024-01-15T09:00:00Z",
            end: "2024-01-19T18:00:00Z",
          },
        },
      });

      const result = await Orchestrator.runFullPipeline({
        repoRoot: tempDir,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.plan.groups.length).toBeGreaterThan(0);
        expect(result.value.iterations).toBeGreaterThanOrEqual(1);
      }
    });

    test("respects max iterations", async () => {
      await createInitialCommit();
      await createChanges();
      await createConfig({
        llm: { selected: { provider: "openrouter" } },
        defaults: {
          messageStyle: "conventional",
          intent: "feature development",
          dateRange: {
            start: "2024-01-15T09:00:00Z",
            end: "2024-01-19T18:00:00Z",
          },
          maxIterations: 2,
        },
      });

      const result = await Orchestrator.runFullPipeline({
        repoRoot: tempDir,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.iterations).toBeLessThanOrEqual(2);
      }
    });

    test("returns fromCache flag", async () => {
      await createInitialCommit();
      await createChanges();
      await createConfig({
        llm: { selected: { provider: "openrouter" } },
        defaults: {
          messageStyle: "conventional",
          intent: "feature development",
          dateRange: {
            start: "2024-01-15T09:00:00Z",
            end: "2024-01-19T18:00:00Z",
          },
        },
      });

      // Clean up any existing cache
      await PlanCache.invalidateAllCaches();

      // First run - cache miss
      const result1 = await Orchestrator.runFullPipeline({
        repoRoot: tempDir,
      });
      expect(result1.ok).toBe(true);
      if (result1.ok) {
        expect(result1.value.fromCache).toBe(false);
      }

      // Second run - cache hit
      const result2 = await Orchestrator.runFullPipeline({
        repoRoot: tempDir,
      });
      expect(result2.ok).toBe(true);
      if (result2.ok) {
        expect(result2.value.fromCache).toBe(true);
      }

      // Clean up
      await PlanCache.invalidateAllCaches();
    });

    test("regenerate flag invalidates cache", async () => {
      await createInitialCommit();
      await createChanges();
      await createConfig({
        llm: { selected: { provider: "openrouter" } },
        defaults: {
          messageStyle: "conventional",
          intent: "feature development",
          dateRange: {
            start: "2024-01-15T09:00:00Z",
            end: "2024-01-19T18:00:00Z",
          },
        },
      });

      // Clean up any existing cache
      await PlanCache.invalidateAllCaches();

      // First run
      await Orchestrator.runFullPipeline({ repoRoot: tempDir });

      // Second run with regenerate
      const result = await Orchestrator.runFullPipeline({
        repoRoot: tempDir,
        regenerate: true,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.fromCache).toBe(false);
      }

      // Clean up
      await PlanCache.invalidateAllCaches();
    });
  });

  describe("getPlanSummary", () => {
    test("returns correct plan summary", async () => {
      await createInitialCommit();
      await createChanges();
      await createConfig({
        llm: { selected: { provider: "openrouter" } },
        defaults: {
          messageStyle: "conventional",
          intent: "feature development",
          dateRange: {
            start: "2024-01-15T09:00:00Z",
            end: "2024-01-19T18:00:00Z",
          },
        },
      });

      const pipelineResult = await Orchestrator.runFullPipeline({
        repoRoot: tempDir,
      });

      expect(pipelineResult.ok).toBe(true);
      if (pipelineResult.ok) {
        const summary = Orchestrator.getPlanSummary(pipelineResult.value.plan);
        expect(summary.commitCount).toBeGreaterThan(0);
        expect(summary.fileCount).toBeGreaterThan(0);
        expect(summary.messages.length).toBeGreaterThan(0);
      }
    });
  });

  describe("runExecutionPhase", () => {
    test("dry-run returns plan without executing", async () => {
      await createInitialCommit();
      await createChanges();
      await createConfig({
        llm: { selected: { provider: "openrouter" } },
        defaults: {
          messageStyle: "conventional",
          intent: "feature development",
          dateRange: {
            start: "2024-01-15T09:00:00Z",
            end: "2024-01-19T18:00:00Z",
          },
        },
      });

      const pipelineResult = await Orchestrator.runFullPipeline({
        repoRoot: tempDir,
      });

      expect(pipelineResult.ok).toBe(true);
      if (pipelineResult.ok) {
        const execResult = await Orchestrator.runExecutionPhase({
          plan: pipelineResult.value.plan,
          repoRoot: tempDir,
          dryRun: true,
        });

        expect(execResult.ok).toBe(true);
        if (execResult.ok) {
          expect(execResult.value.status).toBe("dry-run");
          expect(execResult.value.completedGroups.length).toBe(0);
        }
      }
    });
  });
});