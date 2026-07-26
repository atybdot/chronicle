import * as p from "@clack/prompts";
import pc from "picocolors";
import { Orchestrator } from "../lib/agents/orchestrator";
import { loadConfig, saveConfig } from "../lib/config";
import { isGitRepo } from "../lib/git";
import { telemetry, createTimer } from "../lib/telemetry";
import type { AgentCommitPlan, Config } from "../types";

type BackfillFlags = {
  path?: string;
  dateRange?: string;
  dryRun?: boolean;
  output?: "summary" | "diff" | "full" | "visual" | "json" | "minimal";
  regenerate?: boolean;
  resume?: boolean;
  model?: string;
  provider?: string;
};

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function renderPlanSummary(plan: AgentCommitPlan): string {
  const lines: string[] = [];

  lines.push(pc.bold("\n📋 Commit Plan\n"));

  // Commit count
  lines.push(pc.cyan(`  ${plan.groups.length} commits planned`));

  // Date range from timestamps
  const dates = plan.timestampAssignments.map(t => new Date(t.commitDate));
  if (dates.length > 0) {
    const startDate = new Date(Math.min(...dates.map(d => d.getTime())));
    const endDate = new Date(Math.max(...dates.map(d => d.getTime())));
    lines.push(pc.dim(`  Date range: ${formatDate(startDate)} - ${formatDate(endDate)}`));
  }

  // Message preview (first 5)
  lines.push(pc.dim("\n  Messages:"));
  const previewMessages = plan.messages.slice(0, 5);
  for (const msg of previewMessages) {
    lines.push(pc.dim(`    - ${msg.subject}`));
  }
  if (plan.messages.length > 5) {
    lines.push(pc.dim(`    ... and ${plan.messages.length - 5} more`));
  }

  // File list
  const fileSet = new Set<string>();
  for (const group of plan.groups) {
    for (const filePath of group.filePaths) {
      fileSet.add(filePath);
    }
  }
  lines.push(pc.dim(`\n  Files: ${fileSet.size} files affected`));

  // Audit signals
  if (plan.auditSignals.length > 0) {
    lines.push(pc.yellow("\n  ⚠️  Audit warnings:"));
    for (const signal of plan.auditSignals.slice(0, 3)) {
      lines.push(pc.yellow(`    - ${signal.issue}`));
    }
    if (plan.auditSignals.length > 3) {
      lines.push(pc.yellow(`    ... and ${plan.auditSignals.length - 3} more`));
    }
  }

  return lines.join("\n");
}

function renderExecutionProgress(
  groupIndex: number,
  totalGroups: number,
  groupName: string
): string {
  return `  Commit ${groupIndex + 1}/${totalGroups}: ${groupName}`;
}

export async function handleBackfill(flags: BackfillFlags) {
  const timer = createTimer();
  const cwd = flags.path ?? process.cwd();

  telemetry.track({
    event: "command_invoked",
    properties: {
      command: "backfill",
      interactive: false,
      success: true,
    },
  });

  // Check if git repo
  if (!(await isGitRepo(cwd))) {
    p.cancel("Not a git repository");
    return;
  }

  const spinner = p.spinner();
  spinner.start("Loading configuration...");

  // Load config
  const config = await loadConfig();

  // Merge CLI flags into config
  if (flags.model) {
    config.llm.selected.model = flags.model;
  }
  if (flags.provider) {
    // Validate provider type
    const validProviders = ["openrouter", "openai", "anthropic", "gemini", "ollama", "cloudflare", "opencode-zen", "groq"];
    if (validProviders.includes(flags.provider)) {
      config.llm.selected.provider = flags.provider as Config["llm"]["selected"]["provider"];
    }
  }

  spinner.stop("Configuration loaded");

  // Run the full pipeline
  spinner.start("Analyzing changes with AI...");

  const pipelineResult = await Orchestrator.runFullPipeline({
    repoRoot: cwd,
    dryRun: flags.dryRun,
    regenerate: flags.regenerate,
    resume: flags.resume,
  });

  if (!pipelineResult.ok) {
    spinner.stop("Analysis failed");
    p.log.error(pc.red(pipelineResult.error));
    return;
  }

  const { plan, fromCache } = pipelineResult.value;
  spinner.stop(fromCache ? "Loaded plan from cache" : "Analysis complete");

  // Render plan summary
  console.log(renderPlanSummary(plan));

  // Handle dry-run mode
  if (flags.dryRun) {
    const action = await p.select({
      message: "What would you like to do?",
      options: [
        { value: "apply", label: "Apply these commits", hint: "Execute the commit plan" },
        { value: "cancel", label: "Cancel", hint: "Exit without making changes" },
      ],
    });

    if (p.isCancel(action) || action === "cancel") {
      p.cancel("Operation cancelled - no changes were made");
      process.exit(0);
    }
  } else {
    // Prompt for approval
    const confirm = await p.confirm({
      message: "Execute this commit plan?",
      initialValue: false,
    });

    if (p.isCancel(confirm) || !confirm) {
      p.cancel("Operation cancelled");
      process.exit(0);
    }
  }

  // Execute the plan
  spinner.start("Executing commits...");

  const executionResult = await Orchestrator.runExecutionPhase({
    plan,
    repoRoot: cwd,
    dryRun: false,
    resume: flags.resume,
  });

  if (!executionResult.ok) {
    spinner.stop("Execution failed");
    p.log.error(pc.red(executionResult.error));
    return;
  }

  const { status, completedGroups, failedGroups, totalGroups } = executionResult.value;
  spinner.stop("Execution complete");

  // Show final summary
  let resultMessage = "";

  if (status === "complete") {
    resultMessage = pc.green(`✅ Successfully created ${completedGroups.length} commits!`);
  } else if (status === "partial") {
    resultMessage = pc.yellow(
      `⚠️  Created ${completedGroups.length}/${totalGroups} commits (${failedGroups.length} failed)`
    );
  }

  if (failedGroups.length > 0) {
    resultMessage += pc.dim(`\n\n   Failed groups: ${failedGroups.join(", ")}`);
  }

  resultMessage += pc.dim(`\n\n   Backup branch created before execution`);

  p.outro(resultMessage);

  telemetry.track({
    event: "backfill_executed",
    properties: {
      commits_created: completedGroups.length,
      commits_skipped: failedGroups.length,
      total_files: plan.groups.reduce((sum, g) => sum + g.filePaths.length, 0),
      duration_ms: timer(),
      success: status === "complete",
    },
  });
}

export const __internal = {
  renderPlanSummary,
  renderExecutionProgress,
  formatDate,
};
