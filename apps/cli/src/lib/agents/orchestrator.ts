import { createHash } from "crypto";
import type {
  CommitGroup,
  CommitMessage,
  TimestampAssignment,
  AuditSignal,
  AgentCommitPlan,
  Config,
  HunkLedger,
  HunkSummary,
  ExecutionState,
} from "../../types";
import { loadConfig } from "../config";
import { getDiffs, parseDiffs, isGitRepo } from "../git";
import { readLedger, writeLedger, verifyHunksPending } from "../hunk-ledger";
import { PlanCache } from "../cache";
import { runFileAnalyzer } from "./file-analyzer";
import { CommitPlanner } from "./commit-planner";
import { MessageWriter } from "./message-writer";
import { TimestampDistributor } from "./timestamp-distributor";
import { Auditor } from "./auditor";
import { Executor } from "./executor";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

type RunAnalysisInput = {
  repoRoot: string;
};

type RunAuditInput = {
  plan: AgentCommitPlan;
  repoRoot: string;
};

type RunFullPipelineInput = {
  repoRoot: string;
  dryRun?: boolean;
  regenerate?: boolean;
  resume?: boolean;
};

type RunExecutionInput = {
  plan: AgentCommitPlan;
  repoRoot: string;
  dryRun?: boolean;
  resume?: boolean;
};

type AnalysisResult = {
  groups: CommitGroup[];
  messages: CommitMessage[];
  timestampAssignments: TimestampAssignment[];
  auditSignals: AuditSignal[];
};

type PipelineResult = {
  plan: AgentCommitPlan;
  iterations: number;
  fromCache: boolean;
};

type PlanSummary = {
  commitCount: number;
  dateRange: { start: string; end: string };
  messages: Array<{ groupId: string; subject: string }>;
  fileCount: number;
  auditSignals: AuditSignal[];
};

type ExecutionResult = {
  status: "complete" | "partial" | "dry-run" | "cancelled";
  completedGroups: string[];
  failedGroups: string[];
  totalGroups: number;
  ledger: HunkLedger;
};

function computeDiffHash(diffs: ReturnType<typeof parseDiffs>): string {
  const content = diffs
    .map((d) => d.filePath + d.hunks.map((h) => h.content).join(""))
    .join("");
  return createHash("sha256").update(content).digest("hex");
}

function computeConfigHash(config: Config): string {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

export const Orchestrator = {
  async runAnalysisPhase(
    input: RunAnalysisInput
  ): Promise<Result<AnalysisResult>> {
    const { repoRoot } = input;

    // Check if git repo
    const isRepo = await isGitRepo(repoRoot);
    if (!isRepo) {
      return { ok: false, error: "Not a git repository" };
    }

    // Load config
    const config = await loadConfig();

    // Get diffs
    const diffs = await getDiffs(undefined, repoRoot);
    if (diffs.length === 0) {
      return {
        ok: true,
        value: {
          groups: [],
          messages: [],
          timestampAssignments: [],
          auditSignals: [],
        },
      };
    }

    // Dispatch FileAnalyzer
    const fileAnalyzerResult = await runFileAnalyzer(repoRoot);
    if ("error" in fileAnalyzerResult) {
      return { ok: false, error: `FileAnalyzer failed: ${fileAnalyzerResult.error}` };
    }

    // Read or initialize ledger using file analyzer's hunk IDs
    const diffHash = computeDiffHash(diffs);
    const configHash = computeConfigHash(config);
    let ledger: HunkLedger;

    const ledgerResult = await readLedger(repoRoot);
    if (ledgerResult.ok) {
      ledger = ledgerResult.value;
    } else {
      // Initialize new ledger with hunk IDs and file metadata from summaries
      const hunkToFile = new Map<string, { file: string; hunkIndex: number }>();
      for (const summary of fileAnalyzerResult.summaries) {
        summary.hunkIds.forEach((id, index) => {
          hunkToFile.set(id, { file: summary.filePath, hunkIndex: index });
        });
      }
      const hunks = Object.fromEntries(
        [...hunkToFile.entries()].map(([id, meta]) => [
          id,
          { id, file: meta.file, hunkIndex: meta.hunkIndex, status: "pending" as const, commitId: null },
        ])
      );
      const newLedger: HunkLedger = {
        gitDiffHash: diffHash,
        configHash,
        hunks,
        newFiles: {},
        commits: {},
        ledgerVersion: 1,
      };
      const initResult = await writeLedger(newLedger, repoRoot);
      if (!initResult.ok) {
        return { ok: false, error: `Failed to initialize ledger: ${initResult.error}` };
      }
      ledger = newLedger;
    }

    // Get pending hunk IDs
    const allHunkIds = Object.keys(ledger.hunks);
    const pendingResult = verifyHunksPending(allHunkIds, ledger);
    if (!pendingResult.ok) {
      return { ok: false, error: `Failed to verify hunks: ${pendingResult.error}` };
    }
    const pendingHunkIds = pendingResult.value;

    // Filter summaries to only pending hunks
    const pendingSummaries = fileAnalyzerResult.summaries.filter((s) =>
      s.hunkIds.some((id) => pendingHunkIds.includes(id))
    );

    if (pendingSummaries.length === 0) {
      return {
        ok: true,
        value: {
          groups: [],
          messages: [],
          timestampAssignments: [],
          auditSignals: [],
        },
      };
    }

    // Dispatch CommitPlanner
    const intent = config.defaults?.intent ?? "feature development";
    const commitPlannerResult = CommitPlanner.groupHunks(
      pendingSummaries,
      intent
    );
    if (!Array.isArray(commitPlannerResult)) {
      return { ok: false, error: `CommitPlanner failed: ${commitPlannerResult.error}` };
    }
    const groups = commitPlannerResult;

    // Dispatch MessageWriter
    const styleReference = await MessageWriter.getStyleReference(repoRoot, 10);
    const messages = MessageWriter.generateMessages(groups, styleReference);

    // Dispatch TimestampDistributor
    // Config doesn't have dateRange, so use a default 7-day range
    const dateRange = {
      start: new Date().toISOString(),
      end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const timestampResult = await TimestampDistributor.distribute_timestamps(
      groups,
      messages,
      intent,
      dateRange
    );

    return {
      ok: true,
      value: {
        groups,
        messages,
        timestampAssignments: timestampResult.timestamps,
        auditSignals: [],
      },
    };
  },

  async runAuditPhase(
    input: RunAuditInput
  ): Promise<Result<{ signals: AuditSignal[] }>> {
    const { plan, repoRoot } = input;

    // Read ledger for coverage verification
    const ledgerResult = await readLedger(repoRoot);
    if (!ledgerResult.ok) {
      return { ok: false, error: `Failed to read ledger: ${ledgerResult.error}` };
    }

    // Run Auditor
    const auditResult = await Auditor.review_plan({
      groups: plan.groups,
      ledger: ledgerResult.value,
    });

    return { ok: true, value: auditResult };
  },

  async runFullPipeline(
    input: RunFullPipelineInput
  ): Promise<Result<PipelineResult>> {
    const { repoRoot, dryRun = false, regenerate = false, resume = false } = input;

    // Load config
    const config = await loadConfig();
    const intent = config.defaults?.intent ?? "feature development";

    // Get diffs for cache key
    const diffs = await getDiffs(undefined, repoRoot);
    if (diffs.length === 0) {
      return { ok: false, error: "No changes to backfill" };
    }

    // Compute cache key
    const diffHash = computeDiffHash(diffs);
    const configHash = computeConfigHash(config);
    const ledgerResult = await readLedger(repoRoot);
    const committedHunkIds = ledgerResult.ok
      ? Object.entries(ledgerResult.value.hunks)
          .filter(([_, h]) => h.status === "committed")
          .map(([id]) => id)
      : [];
    const combinedHash = createHash("sha256").update(diffHash + configHash).digest("hex");
    const planHash = PlanCache.computePlanHash(combinedHash, config, intent, committedHunkIds);

    // Check cache (skip if regenerate or resume)
    let plan: AgentCommitPlan;
    let fromCache = false;

    if (!regenerate && !resume) {
      const cachedPlan = await PlanCache.getCachedPlan(planHash);
      if (cachedPlan.ok && cachedPlan.value) {
        plan = cachedPlan.value;
        fromCache = true;
      } else {
        // Cache miss - run analysis
        const result = await Orchestrator.runPipelineWithAudit({ repoRoot, config, planHash });
        if (!result.ok) return result;
        plan = result.value.plan;

        // Write to cache
        await PlanCache.writePlanCache(plan, planHash);
      }
    } else if (resume) {
      // Resume mode - load execution state
      const executionState = await PlanCache.getExecutionState(planHash);
      if (executionState.ok && executionState.value) {
        // Load cached plan
        const cachedPlan = await PlanCache.getCachedPlan(planHash);
        if (cachedPlan.ok && cachedPlan.value) {
          plan = cachedPlan.value;
          fromCache = true;
        } else {
          // No cached plan for resume - run analysis
          const result = await Orchestrator.runPipelineWithAudit({ repoRoot, config, planHash });
          if (!result.ok) return result;
          plan = result.value.plan;
          await PlanCache.writePlanCache(plan, planHash);
        }
      } else {
        // No execution state - start fresh
        const result = await Orchestrator.runPipelineWithAudit({ repoRoot, config, planHash });
        if (!result.ok) return result;
        plan = result.value.plan;
        await PlanCache.writePlanCache(plan, planHash);
      }
    } else {
      // Regenerate mode - invalidate cache and run fresh
      await PlanCache.invalidateCache(planHash);
      const result = await Orchestrator.runPipelineWithAudit({ repoRoot, config, planHash });
      if (!result.ok) return result;
      plan = result.value.plan;
      await PlanCache.writePlanCache(plan, planHash);
    }

    return {
      ok: true,
      value: {
        plan,
        iterations: 1,
        fromCache,
      },
    };
  },

  async runPipelineWithAudit(
    input: RunAnalysisInput & { config: Config; planHash: string }
  ): Promise<Result<{ plan: AgentCommitPlan; iterations: number }>> {
    const { repoRoot, config, planHash } = input;

    // Run analysis phase
    const analysisResult = await Orchestrator.runAnalysisPhase({ repoRoot });
    if (!analysisResult.ok) {
      return analysisResult;
    }

    const maxIterations = 3; // Default max iterations for audit loop

    let plan: AgentCommitPlan = {
      planHash,
      groups: analysisResult.value.groups,
      messages: analysisResult.value.messages,
      timestampAssignments: analysisResult.value.timestampAssignments,
      auditSignals: analysisResult.value.auditSignals,
      version: 1,
    };

    let iterations = 0;
    let hasErrors = true;

    // Audit loop
    while (hasErrors && iterations < maxIterations) {
      iterations++;

      const auditResult = await Orchestrator.runAuditPhase({ plan, repoRoot });
      if (!auditResult.ok) {
        return auditResult;
      }

      const errorSignals = auditResult.value.signals.filter(
        (s) => s.severity === "error"
      );

      if (errorSignals.length === 0) {
        hasErrors = false;
        break;
      }

      // Log warnings
      const warningSignals = auditResult.value.signals.filter(
        (s) => s.severity === "warning"
      );
      for (const warning of warningSignals) {
        console.warn(`Auditor warning: ${warning.issue}`);
      }

      // Re-dispatch affected groups (simplified: re-run full analysis)
      const reAnalysisResult = await Orchestrator.runAnalysisPhase({ repoRoot });
      if (reAnalysisResult.ok) {
        plan = {
          ...plan,
          groups: reAnalysisResult.value.groups,
          messages: reAnalysisResult.value.messages,
          timestampAssignments: reAnalysisResult.value.timestampAssignments,
        };
      }
    }

    return { ok: true, value: { plan, iterations } };
  },

  getPlanSummary(plan: AgentCommitPlan): PlanSummary {
    // Find date range from timestamp assignments
    const dates = plan.timestampAssignments.map(t => new Date(t.commitDate));
    const startDate = dates.length > 0 ? new Date(Math.min(...dates.map(d => d.getTime()))) : new Date();
    const endDate = dates.length > 0 ? new Date(Math.max(...dates.map(d => d.getTime()))) : new Date();

    // Count unique files
    const fileSet = new Set<string>();
    for (const group of plan.groups) {
      for (const filePath of group.filePaths) {
        fileSet.add(filePath);
      }
    }

    return {
      commitCount: plan.groups.length,
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      messages: plan.messages.map(m => ({
        groupId: m.groupId,
        subject: m.subject,
      })),
      fileCount: fileSet.size,
      auditSignals: plan.auditSignals,
    };
  },

  async runExecutionPhase(
    input: RunExecutionInput
  ): Promise<Result<ExecutionResult>> {
    const { plan, repoRoot, dryRun = false, resume = false } = input;

    // Dry-run mode - return plan summary without executing
    if (dryRun) {
      const ledgerResult = await readLedger(repoRoot);
      return {
        ok: true,
        value: {
          status: "dry-run",
          completedGroups: [],
          failedGroups: [],
          totalGroups: plan.groups.length,
          ledger: ledgerResult.ok ? ledgerResult.value : {
            gitDiffHash: "",
            configHash: "",
            hunks: {},
            newFiles: {},
            commits: {},
            ledgerVersion: 1,
          },
        },
      };
    }

    // Read ledger
    const ledgerResult = await readLedger(repoRoot);
    if (!ledgerResult.ok) {
      return { ok: false, error: `Failed to read ledger: ${ledgerResult.error}` };
    }
    let ledger = ledgerResult.value;

    // Get execution state for resume
    let completedGroups: string[] = [];
    let failedGroups: string[] = [];

    if (resume) {
      const executionState = await PlanCache.getExecutionState(plan.planHash);
      if (executionState.ok && executionState.value) {
        completedGroups = executionState.value.completedGroups;
        failedGroups = executionState.value.failedGroups;
      }
    }

    // Create backup branch
    const backupResult = await Executor.createBackupBranch(repoRoot);
    if (!backupResult.ok) {
      return { ok: false, error: `Failed to create backup branch: ${backupResult.error}` };
    }

    // Execute groups in order
    const sortedGroups = [...plan.groups].sort((a, b) => a.order - b.order);

    // Get diffs for executor
    const diffs = await getDiffs(undefined, repoRoot);

    for (const group of sortedGroups) {
      // Skip already completed groups (resume mode)
      if (completedGroups.includes(group.id)) {
        continue;
      }

      // Find timestamp for this group
      const timestamp = plan.timestampAssignments.find(t => t.groupId === group.id);
      const date = timestamp?.commitDate ?? new Date().toISOString();

      // Execute the group
      const execResult = await Executor.executeGroup({
        group,
        ledger,
        diffs,
        date,
        repoRoot,
      });

      if (execResult.ok) {
        completedGroups.push(group.id);
        ledger = execResult.value.ledger;

        // Update execution state in cache
        await PlanCache.updateExecutionState(plan.planHash, {
          planHash: plan.planHash,
          completedGroups,
          failedGroups,
          ledger,
        });
      } else {
        failedGroups.push(group.id);

        // Update execution state with failure
        await PlanCache.updateExecutionState(plan.planHash, {
          planHash: plan.planHash,
          completedGroups,
          failedGroups,
          ledger,
        });

        // Continue with next group (don't stop on single failure)
        console.warn(`Group ${group.id} failed: ${execResult.error}`);
      }
    }

    const status = failedGroups.length === 0 ? "complete" : "partial";

    return {
      ok: true,
      value: {
        status,
        completedGroups,
        failedGroups,
        totalGroups: sortedGroups.length,
        ledger,
      },
    };
  },
};