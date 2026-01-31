import * as p from "@clack/prompts";
import pc from "picocolors";
import { Result } from "better-result";
import {
  isGitRepo,
  getGitStatus,
  getFileDiff,
  getFileContent,
} from "../lib/git";
import { analyzeChangesSafe, parseDateRange, formatAIError } from "../lib/ai";
import { telemetry } from "../lib/telemetry";
import type { FileChange } from "../types";

export const analyzeProcedure = {
  meta: {
    description: "Analyze uncommitted changes and generate a commit plan",
  },
  input: {
    path: {
      type: "string",
      optional: true,
      describe: "Path to git repository (defaults to current directory)",
    },
    dateRange: {
      type: "string",
      optional: true,
      describe: "Date range for commits (e.g., 'last 30 days', 'spread over 2 weeks')",
    },
    includeStaged: { type: "boolean", default: true, describe: "Include staged changes" },
    includeUnstaged: { type: "boolean", default: true, describe: "Include unstaged changes" },
    includeUntracked: { type: "boolean", default: true, describe: "Include untracked files" },
  },
};

export async function handleAnalyze(input: {
  path?: string;
  dateRange?: string;
  includeStaged?: boolean;
  includeUnstaged?: boolean;
  includeUntracked?: boolean;
}) {
  const cwd = input.path ?? process.cwd();

  telemetry.track({
    event: "command_invoked",
    properties: {
      command: "analyze",
      success: true,
    },
  });

  if (!(await isGitRepo(cwd))) {
    p.cancel("Not a git repository");
    process.exit(1);
  }

  const spinner = p.spinner();
  spinner.start("Analyzing repository...");

  const status = await getGitStatus(cwd);
  const allFiles: FileChange[] = [];
  const diffs = new Map<string, string>();
  const untrackedContent = new Map<string, string>();

  if (input.includeStaged) {
    allFiles.push(...status.staged);
    for (const file of status.staged) {
      const diff = await getFileDiff(file.path, true, cwd);
      if (diff) diffs.set(file.path, diff);
    }
  }

  if (input.includeUnstaged) {
    for (const file of status.unstaged) {
      if (!allFiles.find((f) => f.path === file.path)) {
        allFiles.push(file);
      }
    }
    for (const file of status.unstaged) {
      if (!diffs.has(file.path)) {
        const diff = await getFileDiff(file.path, false, cwd);
        if (diff) diffs.set(file.path, diff);
      }
    }
  }

  if (input.includeUntracked) {
    for (const path of status.untracked) {
      allFiles.push({ path, status: "added" });
      const content = await getFileContent(path, cwd);
      if (content) untrackedContent.set(path, content);
    }
  }

  if (allFiles.length === 0) {
    spinner.stop("No changes found");
    p.note("Nothing to analyze. Make some changes first!");
    return;
  }

  spinner.message(`Found ${allFiles.length} files, analyzing with AI...`);

  const analysisResult = await analyzeChangesSafe(allFiles, diffs, untrackedContent);

  if (!Result.isOk(analysisResult)) {
    spinner.stop("Analysis failed");
    console.error(analysisResult.error);
    process.exit(1);
  }

  const analysis = analysisResult.value;
  spinner.stop("Analysis complete!");

  telemetry.track({
    event: "backfill_plan_generated",
    properties: {
      commits_suggested: analysis.suggestedCommits,
      files_count: allFiles.length,
      date_range_days: analysis.suggestedDays,
      dry_run: true,
      output_format: "visual",
    },
  });

  let dateRangeInfo: { start: Date; end: Date } | null = null;
  if (input.dateRange) {
    const dateSpinner = p.spinner();
    dateSpinner.start("Parsing date range...");
    try {
      dateRangeInfo = await parseDateRange(input.dateRange);
      dateSpinner.stop(
        `${dateRangeInfo.start.toLocaleDateString()} - ${dateRangeInfo.end.toLocaleDateString()}`,
      );
    } catch (error) {
      dateSpinner.stop("Failed to parse date range");
      p.log.warn(pc.yellow(`Could not parse date range: ${formatAIError(error)}`));
    }
  }

  console.log(pc.bold("\n🔍 Analysis Results\n"));
  console.log(pc.dim(analysis.reasoning));
  console.log(`\n${pc.cyan("Suggested commits:")} ${analysis.suggestedCommits}`);
  if (dateRangeInfo) {
    const days = Math.ceil(
      (dateRangeInfo.end.getTime() - dateRangeInfo.start.getTime()) / (1000 * 60 * 60 * 24),
    );
    console.log(
      `${pc.cyan("Date range:")} ${dateRangeInfo.start.toLocaleDateString()} - ${dateRangeInfo.end.toLocaleDateString()} (${days} days)`,
    );
  } else {
    console.log(`${pc.cyan("Suggested days:")} ${analysis.suggestedDays}`);
  }

  console.log(pc.bold("\n📦 Proposed Commit Groups:\n"));

  for (const group of analysis.groups.sort((a, b) => a.order - b.order)) {
    const categoryColor =
      group.category === "feature" ? pc.green : group.category === "fix" ? pc.red : pc.yellow;

    console.log(`  ${categoryColor(`[${group.category}]`)} ${pc.bold(group.name)}`);
    console.log(`  ${pc.dim(group.description)}`);
    console.log(`  ${pc.dim("Files:")} ${group.files.join(", ")}`);
    console.log();
  }

  return {
    suggestedDays: analysis.suggestedDays,
    groups: analysis.groups,
  };
}
