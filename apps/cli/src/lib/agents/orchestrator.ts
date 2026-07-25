import { createHash } from "crypto";
import type {
  CommitGroup,
  CommitMessage,
  TimestampAssignment,
  AuditSignal,
  AgentCommitPlan,
  ChronicleConfig,
  HunkLedger,
  HunkSummary,
} from "../../types";
import { loadConfig } from "../config";
import { getDiffs, parseDiffs, isGitRepo } from "../git";
import { readLedger, writeLedger, verifyHunksPending } from "../hunk-ledger";
import { runFileAnalyzer } from "./file-analyzer";
import { CommitPlanner } from "./commit-planner";
import { MessageWriter } from "./message-writer";
import { TimestampDistributor } from "./timestamp-distributor";
import { Auditor } from "./auditor";

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
};

function computeDiffHash(diffs: ReturnType<typeof parseDiffs>): string {
  const content = diffs
    .map((d) => d.filePath + d.hunks.map((h) => h.content).join(""))
    .join("");
  return createHash("sha256").update(content).digest("hex");
}

function computeConfigHash(config: ChronicleConfig): string {
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
    const dateRange = config.defaults?.dateRange ?? {
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
    const { repoRoot } = input;

    // Run analysis phase
    const analysisResult = await Orchestrator.runAnalysisPhase({ repoRoot });
    if (!analysisResult.ok) {
      return analysisResult;
    }

    // Load config for max iterations
    const config = await loadConfig();
    const maxIterations = (config.defaults as Record<string, unknown>)?.maxIterations ?? 3;

    // Compute plan hash from groups, messages, and timestamps
    const planContent = JSON.stringify({
      groups: analysisResult.value.groups,
      messages: analysisResult.value.messages,
      timestamps: analysisResult.value.timestampAssignments,
    });
    const planHash = createHash("sha256").update(planContent).digest("hex");

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

    return {
      ok: true,
      value: {
        plan,
        iterations,
      },
    };
  },
};