import * as p from "@clack/prompts";
import pc from "picocolors";
import { Result } from "better-result";
import {
  isGitRepo,
  getGitStatus,
  getFileDiff,
  getFileContent,
  stageFiles,
  stageFileHunks,
  unstageAll,
  createCommit,
  createBackupBranch,
  hasGitIdentity,
  getGitIdentity,
  setGitConfig,
  hasStagedChanges,
} from "../lib/git";
import { analyzeChangesSafe, generateCommitMessages, parseDateRange, formatAIError } from "../lib/ai";
import { distributeCommits } from "../lib/distribution";
import { loadConfig, saveConfig } from "../lib/config";
import { renderCommitList, renderPlanSummary, exportPlanAsJson } from "../lib/output";
import { telemetry, createTimer } from "../lib/telemetry";
import type { FileChange, PlannedCommit, CommitPlan, FileHunkSpec } from "../types";

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function handleBackfill(input: {
  path?: string;
  dateRange?: string;
  startDate?: string;
  endDate?: string;
  dryRun?: boolean;
  interactive?: boolean;
  output?: "visual" | "json" | "minimal";
}) {
  const timer = createTimer();
  const cwd = input.path ?? process.cwd();

  telemetry.track({
    event: "command_invoked",
    properties: {
      command: "backfill",
      interactive: input.interactive ?? false,
      success: true,
    },
  });

  if (!(await isGitRepo(cwd))) {
    p.cancel("Not a git repository");
    process.exit(1);
  }

  p.intro(pc.bgCyan(pc.black(" chronicle ")));

  const spinner = p.spinner();
  spinner.start("Analyzing repository...");

  const status = await getGitStatus(cwd);
  const allFiles: FileChange[] = [];
  const diffs = new Map<string, string>();
  const untrackedContent = new Map<string, string>();

  for (const file of [...status.staged, ...status.unstaged]) {
    if (!allFiles.find((f) => f.path === file.path)) {
      allFiles.push(file);
      const diff = await getFileDiff(file.path, status.staged.includes(file), cwd);
      if (diff) diffs.set(file.path, diff);
    }
  }

  for (const path of status.untracked) {
    allFiles.push({ path, status: "added" });
    const content = await getFileContent(path, cwd);
    if (content) untrackedContent.set(path, content);
  }

  if (allFiles.length === 0) {
    spinner.stop("No changes found");
    p.cancel("No changes to backfill");
    process.exit(1);
  }

  spinner.message(`Found ${allFiles.length} files, analyzing...`);

  const analysisResult = await analyzeChangesSafe(allFiles, diffs, untrackedContent);

  if (!Result.isOk(analysisResult)) {
    spinner.stop("Analysis failed");
    console.error(analysisResult.error);
    process.exit(1);
  }

  const analysis = analysisResult.value;
  spinner.stop(`Analysis complete: ${analysis.suggestedCommits} commits suggested`);

  // Ask for date range interactively if not provided
  let dateRange: { start: Date; end: Date };
  const hasDateRangeInput = input.dateRange || (input.startDate && input.endDate);

  if (!hasDateRangeInput && input.interactive) {
    console.log(pc.dim(`\nSuggested timeline: ${analysis.suggestedDays} days\n`));

    const dateRangeInput = await p.text({
      message: "Enter date range for commits:",
      placeholder: "e.g., last 30 days, last 2 weeks, 2024-01-01 to 2024-12-31",
      defaultValue: `last ${analysis.suggestedDays} days`,
    });

    if (p.isCancel(dateRangeInput)) {
      p.cancel("Operation cancelled");
      process.exit(0);
    }

    const dateRangeStr = (dateRangeInput as string).trim() || `last ${analysis.suggestedDays} days`;

    spinner.start("Parsing date range...");
    try {
      dateRange = await parseDateRange(dateRangeStr);
    } catch (error) {
      spinner.stop("Failed to parse date range");
      p.log.error(pc.red(formatAIError(error)));
      process.exit(1);
    }
    spinner.stop(`Date range: ${formatDate(dateRange.start)} - ${formatDate(dateRange.end)}`);
  } else if (input.startDate && input.endDate) {
    dateRange = {
      start: new Date(input.startDate),
      end: new Date(input.endDate),
    };
  } else if (input.dateRange) {
    spinner.start("Parsing date range...");
    try {
      dateRange = await parseDateRange(input.dateRange);
    } catch (error) {
      spinner.stop("Failed to parse date range");
      p.log.error(pc.red(formatAIError(error)));
      process.exit(1);
    }
    spinner.stop("Date range parsed");
  } else {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - analysis.suggestedDays);
    dateRange = { start, end };
  }

  spinner.start("Generating commit messages...");
  const commitGroups = analysis.groups.sort((a, b) => a.order - b.order);
  const messages = await generateCommitMessages(
    commitGroups.map((g) => ({
      files: allFiles.filter((f) => g.files.includes(f.path)),
      category: g.category,
      name: g.name,
      description: g.description,
    })),
  );
  spinner.stop("Commit messages generated");

  const plannedCommits: PlannedCommit[] = commitGroups.map((group, index) => ({
    id: `commit-${index}`,
    message: messages[index] ?? `${group.category}: ${group.name}`,
    description: group.description,
    files: group.files
      .map((filePath) => allFiles.find((f) => f.path === filePath))
      .filter((f): f is NonNullable<typeof f> => f !== undefined),
    fileHunks: group.fileHunks.map((fh) => ({
      path: fh.path,
      hunks: fh.lineRanges.map((lr) => ({ start: lr.start, end: lr.end })),
    })),
    category: group.category as PlannedCommit["category"],
  }));

  spinner.start("Distributing commits across date range...");
  let distributedCommits = await distributeCommits(plannedCommits, dateRange);
  spinner.stop("Distribution complete");

  const plan: CommitPlan = {
    commits: distributedCommits,
    dateRange,
    strategy: "realistic",
    totalFiles: allFiles.length,
    estimatedDuration: `${analysis.suggestedDays} days`,
  };

  telemetry.track({
    event: "backfill_plan_generated",
    properties: {
      commits_suggested: plannedCommits.length,
      files_count: allFiles.length,
      date_range_days: Math.ceil((dateRange.end.getTime() - dateRange.start.getTime()) / (1000 * 60 * 60 * 24)),
      dry_run: input.dryRun ?? true,
      output_format: input.output ?? "visual",
    },
  });

  if (input.output === "json") {
    console.log(exportPlanAsJson(plan));
  } else {
    console.log(renderPlanSummary(plan));
  }

  if (input.dryRun) {
    const action = await p.select({
      message: "What would you like to do?",
      options: [
        { value: "view", label: "View detailed commit information", hint: "See full file lists" },
        { value: "modify-prompt", label: "Modify AI prompt", hint: "Customize commit message style" },
        { value: "apply", label: "Apply these commits", hint: "Execute the commit plan" },
        { value: "cancel", label: "Cancel", hint: "Exit without making changes" },
      ],
    });

    if (p.isCancel(action) || action === "cancel") {
      p.cancel("Operation cancelled - no changes were made");
      process.exit(0);
    }

    if (action === "view") {
      console.log(renderCommitList(distributedCommits));
      const shouldApply = await p.confirm({
        message: "Would you like to apply these commits now?",
        initialValue: false,
      });
      if (p.isCancel(shouldApply) || !shouldApply) {
        p.cancel("Operation cancelled - no changes were made");
        process.exit(0);
      }
    }

    if (action === "modify-prompt") {
      const config = await loadConfig();
      const currentPrompt = config.llm.customPrompt;
      if (currentPrompt) {
        console.log(pc.dim("\nCurrent custom prompt:"));
        console.log(pc.cyan(`  ${currentPrompt}\n`));
      } else {
        console.log(pc.dim("\nNo custom prompt configured.\n"));
      }

      const newPrompt = await p.text({
        message: "Enter custom instructions for AI (or leave empty to clear):",
        placeholder: "e.g., Use lowercase commit messages with emoji prefixes",
        defaultValue: currentPrompt ?? "",
      });

      if (p.isCancel(newPrompt)) {
        p.cancel("Operation cancelled - no changes were made");
        process.exit(0);
      }

      const trimmedPrompt = (newPrompt as string).trim();

      await saveConfig({
        llm: {
          ...config.llm,
          customPrompt: trimmedPrompt || undefined,
        },
      });

      if (trimmedPrompt) {
        console.log(pc.green("\n✅ Custom prompt updated:"));
        console.log(pc.dim(`  ${trimmedPrompt}\n`));
      } else {
        console.log(pc.green("\n✅ Custom prompt cleared\n"));
      }

      const shouldRegenerate = await p.confirm({
        message: "Would you like to regenerate commits with the new prompt?",
        initialValue: true,
      });

      if (p.isCancel(shouldRegenerate) || !shouldRegenerate) {
        p.cancel("Operation cancelled - no changes were made");
        process.exit(0);
      }

      console.log(pc.dim("\nRegenerating commits with new prompt...\n"));

      spinner.start("Regenerating commit messages...");
      const newMessages = await generateCommitMessages(
        commitGroups.map((g) => ({
          files: allFiles.filter((f) => g.files.includes(f.path)),
          category: g.category,
          name: g.name,
          description: g.description,
        })),
      );
      spinner.stop("Commit messages regenerated");

      const newPlannedCommits: PlannedCommit[] = commitGroups.map((group, index) => ({
        id: `commit-${index}`,
        message: newMessages[index] ?? `${group.category}: ${group.name}`,
        description: group.description,
        files: group.files
          .map((filePath) => allFiles.find((f) => f.path === filePath))
          .filter((f): f is NonNullable<typeof f> => f !== undefined),
        category: group.category as PlannedCommit["category"],
      }));

      spinner.start("Distributing commits across date range...");
      distributedCommits = await distributeCommits(newPlannedCommits, dateRange);
      spinner.stop("Distribution complete");

      const newPlan: CommitPlan = {
        commits: distributedCommits,
        dateRange,
        strategy: "realistic",
        totalFiles: allFiles.length,
        estimatedDuration: `${analysis.suggestedDays} days`,
      };

      console.log(pc.bold("\n📋 Updated Commit Plan\n"));
      if (input.output === "json") {
        console.log(exportPlanAsJson(newPlan));
      } else {
        console.log(renderPlanSummary(newPlan));
      }

      const newAction = await p.select({
        message: "What would you like to do?",
        options: [
          { value: "view", label: "View detailed commit information", hint: "See full file lists" },
          { value: "apply", label: "Apply these commits", hint: "Execute the commit plan" },
          { value: "cancel", label: "Cancel", hint: "Exit without making changes" },
        ],
      });

      if (p.isCancel(newAction) || newAction === "cancel") {
        p.cancel("Operation cancelled - no changes were made");
        process.exit(0);
      }

      if (newAction === "view") {
        console.log(renderCommitList(distributedCommits));
        const shouldApply = await p.confirm({
          message: "Would you like to apply these commits now?",
          initialValue: false,
        });
        if (p.isCancel(shouldApply) || !shouldApply) {
          p.cancel("Operation cancelled - no changes were made");
          process.exit(0);
        }
      }
    }
  } else if (input.interactive) {
    const confirm = await p.confirm({
      message: "Execute this commit plan?",
      initialValue: false,
    });
    if (p.isCancel(confirm) || !confirm) {
      p.cancel("Operation cancelled");
      process.exit(0);
    }
  }

  spinner.start("Checking git configuration...");
  const hasIdentity = await hasGitIdentity(cwd);
  if (!hasIdentity) {
    spinner.stop("Git identity not configured");

    const config = await loadConfig();
    let authorName = config.git.authorName;
    let authorEmail = config.git.authorEmail;

    if (!authorName || !authorEmail) {
      p.log.warn(pc.yellow("Git user identity is not configured."));

      const nameInput = await p.text({
        message: "Enter your name for git commits:",
        placeholder: "John Doe",
        validate: (value) => {
          if (!value || value.trim() === "") return "Name is required";
        },
      });

      if (p.isCancel(nameInput)) {
        p.cancel("Operation cancelled");
        process.exit(0);
      }
      authorName = nameInput;

      const emailInput = await p.text({
        message: "Enter your email for git commits:",
        placeholder: "john@example.com",
        validate: (value) => {
          if (!value || value.trim() === "") return "Email is required";
          if (!value.includes("@")) return "Please enter a valid email address";
        },
      });

      if (p.isCancel(emailInput)) {
        p.cancel("Operation cancelled");
        process.exit(0);
      }
      authorEmail = emailInput;

      spinner.start("Configuring git identity...");
      await setGitConfig("user.name", authorName, cwd);
      await setGitConfig("user.email", authorEmail, cwd);

      await saveConfig({
        git: { authorName, authorEmail },
      });
      spinner.stop("Git identity configured");
    } else {
      spinner.start("Configuring git identity from chronicle config...");
      await setGitConfig("user.name", authorName, cwd);
      await setGitConfig("user.email", authorEmail, cwd);
      spinner.stop("Git identity configured from chronicle config");
    }
  } else {
    spinner.stop("Git identity verified");

    const { name, email } = await getGitIdentity(cwd);
    if (name && email) {
      const config = await loadConfig();
      if (!config.git.authorName || !config.git.authorEmail) {
        await saveConfig({
          git: { authorName: name, authorEmail: email },
        });
      }
    }
  }

  spinner.start("Creating backup branch...");
  const backupBranch = await createBackupBranch(cwd);
  if (backupBranch) {
    spinner.stop(`Backup branch created: ${backupBranch}`);
  } else {
    spinner.stop("No backup needed (no existing commits)");
  }

  spinner.start("Executing commits...");

  let successfulCommits = 0;
  const skippedCommits: string[] = [];

  for (let i = 0; i < distributedCommits.length; i++) {
    const commit = distributedCommits[i];
    if (!commit) continue;
    spinner.message(`Commit ${i + 1}/${distributedCommits.length}: ${commit.message}`);

    await unstageAll(cwd);

    let stagedCount = 0;
    
    if (commit.fileHunks && commit.fileHunks.length > 0) {
      const result = await stageFileHunks(commit.fileHunks as FileHunkSpec[], diffs, cwd);
      stagedCount = result.filesStaged.length;
    } else {
      const filePaths = commit.files.map((f) => f.path);
      const stagedFiles = await stageFiles(filePaths, cwd);
      stagedCount = stagedFiles.length;
    }

    if (stagedCount === 0) {
      skippedCommits.push(commit.message);
      continue;
    }

    const hasChanges = await hasStagedChanges(cwd);
    if (!hasChanges) {
      skippedCommits.push(commit.message);
      continue;
    }

    await createCommit(commit.message, commit.scheduledDate ?? new Date(), undefined, undefined, cwd);
    successfulCommits++;
  }

  spinner.stop("All commits processed!");

  telemetry.track({
    event: "backfill_executed",
    properties: {
      commits_created: successfulCommits,
      commits_skipped: skippedCommits.length,
      total_files: allFiles.length,
      duration_ms: timer(),
      success: successfulCommits > 0,
    },
  });

  let resultMessage = pc.green(`✅ Successfully created ${successfulCommits} commits!`);

  if (skippedCommits.length > 0) {
    resultMessage += pc.yellow(`\n\n   ⚠️  Skipped ${skippedCommits.length} commits (no files to stage):`);
    for (const msg of skippedCommits.slice(0, 3)) {
      resultMessage += pc.dim(`\n      - ${msg}`);
    }
    if (skippedCommits.length > 3) {
      resultMessage += pc.dim(`\n      ... and ${skippedCommits.length - 3} more`);
    }
  }

  const backupMessage = backupBranch ? `\n   Backup branch: ${backupBranch}` : "";
  p.outro(
    resultMessage +
      backupMessage +
      pc.yellow(`\n\n   📌 To push to GitHub:`) +
      pc.cyan(`\n   git push origin <branch>`) +
      pc.dim(`\n\n   Note: GitHub will display commits with backdated timestamps in your contribution graph.`),
  );
}
