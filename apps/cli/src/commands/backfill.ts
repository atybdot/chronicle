import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  isGitRepo,
  isGitHookError,
  getGitStatus,
  getFileDiffFromHead,
  getFileContent,
  getFileBytes,
  stageFiles,
  stageFileHunksByIndex,
  unstageAll,
  createCommit,
  createBackupBranch,
  hasGitIdentity,
  getGitIdentity,
  setGitConfig,
  hasStagedChanges,
  getRecentCommits,
} from "../lib/git";
import { parseDateRange, formatAIError, analyzeChangesSafe, generateCommitMessages } from "../lib/ai";
import { distributeCommits } from "../lib/distribution";
import { loadConfig, saveConfig } from "../lib/config";
import { renderCommitList, renderPlanSummary, exportPlanAsJson } from "../lib/output";
import { telemetry, createTimer } from "../lib/telemetry";
import type { FileChange, PlannedCommit, CommitPlan, FileHunkSpec } from "../types";

function buildPlannedCommitsFromAnalysis(
  groups: Array<{
    name: string;
    description: string;
    files: string[];
    commitMessage?: string;
    fileHunks: Array<{
      path: string;
      lineRanges: Array<{ start: number; end: number }>;
      hunkIndices: number[];
    }>;
    category: string;
    order: number;
  }>,
  allFiles: FileChange[],
  messages: string[],
): PlannedCommit[] {
  const commitGroups = [...groups].sort((a, b) => a.order - b.order);

  return commitGroups.map((group, index) => ({
    id: `commit-${index}`,
    message: group.commitMessage ?? messages[index] ?? `${group.category}: ${group.name}`,
    description: group.description,
    files: group.files
      .map((filePath) => allFiles.find((f) => f.path === filePath))
      .filter((f): f is NonNullable<typeof f> => f !== undefined),
    fileHunks: group.fileHunks.map((fileHunk) => ({
      path: fileHunk.path,
      hunks: fileHunk.lineRanges,
      hunkIndices: fileHunk.hunkIndices,
    })),
    category: group.category as PlannedCommit["category"],
  }));
}

function buildFallbackCommitMessage(path: string): string {
  return `chore: include remaining changes in ${path}`;
}

function getMinimumSuggestedTimelineDays(groups: Array<{ fileHunks: Array<{ path: string }> }>): number {
  const analyzableFileCount = groups.reduce((total, group) => total + group.fileHunks.length, 0);
  return Math.max(groups.length, analyzableFileCount);
}

function dedupeChangedFiles(status: Awaited<ReturnType<typeof getGitStatus>>): FileChange[] {
  const files = new Map<string, FileChange>();

  for (const file of [...status.staged, ...status.unstaged]) {
    if (!files.has(file.path)) {
      files.set(file.path, file);
    }
  }

  for (const path of status.untracked) {
    if (!files.has(path)) {
      files.set(path, { path, status: "added" });
    }
  }

  return Array.from(files.values()).sort((a, b) => a.path.localeCompare(b.path));
}

async function getRemainingChangedFiles(cwd: string): Promise<FileChange[]> {
  const status = await getGitStatus(cwd);
  return dedupeChangedFiles(status);
}

type FallbackCommitExecutionResult = {
  created: number;
  messages: string[];
  remainingFiles: FileChange[];
  error?: Error;
};

async function createFallbackCommitsForRemainingChanges(options: {
  cwd: string;
  commitAuthorName?: string;
  commitAuthorEmail?: string;
  noVerify: boolean;
  startDate: Date;
}): Promise<FallbackCommitExecutionResult> {
  const { cwd, commitAuthorName, commitAuthorEmail, noVerify, startDate } = options;
  const remainingFiles = await getRemainingChangedFiles(cwd);
  const messages: string[] = [];
  let created = 0;

  for (const file of remainingFiles) {
    const commitDate = new Date(startDate.getTime() + created * 60_000);

    try {
      await unstageAll(cwd).catch(() => undefined);
      await stageFiles([file.path], cwd);

      if (!(await hasStagedChanges(cwd))) {
        continue;
      }

      const message = buildFallbackCommitMessage(file.path);
      await createCommit(
        message,
        commitDate,
        commitAuthorName,
        commitAuthorEmail,
        cwd,
        noVerify,
      );
      messages.push(message);
      created++;
    } catch (error) {
      await unstageAll(cwd).catch(() => undefined);
      return {
        created,
        messages,
        remainingFiles: await getRemainingChangedFiles(cwd),
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  return {
    created,
    messages,
    remainingFiles: await getRemainingChangedFiles(cwd),
  };
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatExecutionError(error: unknown): string {
  if (error instanceof Error) return error.message.trim();
  return String(error).trim();
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
    return;
  }

  const spinner = p.spinner();
  spinner.start("Checking for changes...");

  const status = await getGitStatus(cwd);
  const allFiles: FileChange[] = [];
  const diffs = new Map<string, string>();
  const untrackedContent = new Map<string, string>();
  const untrackedBytes = new Map<string, Uint8Array>();

  for (const file of [...status.staged, ...status.unstaged]) {
    if (!allFiles.find((f) => f.path === file.path)) {
      allFiles.push(file);
      const diff = await getFileDiffFromHead(file.path, cwd);
      if (diff) diffs.set(file.path, diff);
    }
  }

  for (const path of status.untracked) {
    allFiles.push({ path, status: "added" });
    const bytes = await getFileBytes(path, cwd);
    if (bytes.length > 0) untrackedBytes.set(path, bytes);
    const content = await getFileContent(path, cwd);
    if (content) untrackedContent.set(path, content);
  }

  if (allFiles.length === 0) {
    spinner.stop("No changes found");
    p.cancel("No changes to backfill");
    return;
  }

  const fileCount = allFiles.length;
  const largeRepo = fileCount > 20;
  console.log(pc.dim(`\n  Found ${fileCount} files to analyze${largeRepo ? " (large repo - this may take a minute)" : ""}`));

  spinner.start("Analyzing changes with AI...");

  const analysisResult = await analyzeChangesSafe(
    allFiles,
    diffs,
    untrackedContent,
    untrackedBytes,
  );

  if (analysisResult.isErr()) {
    spinner.stop("Analysis failed");
    p.log.error(pc.red(formatAIError(analysisResult.error)));
    return;
  }

  const analysis = analysisResult.value;
  analysis.suggestedDays = Math.max(
    analysis.suggestedDays,
    getMinimumSuggestedTimelineDays(analysis.groups),
  );
  // Ensure spinner is stopped before any prompts or interactive operations
  spinner.stop();

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
  const recentMessages = (await getRecentCommits(10, cwd)).map((c) => c.message);

  const messages = await generateCommitMessages(
    commitGroups.map((g) => ({
      files: g.files
        .map((filePath) => allFiles.find((f) => f.path === filePath))
        .filter((f): f is NonNullable<typeof f> => f !== undefined),
      category: g.category,
      name: g.name,
      description: g.description,
    })),
    recentMessages,
  );
  spinner.stop("Commit messages generated");

  const plannedCommits = buildPlannedCommitsFromAnalysis(commitGroups, allFiles, messages);

  spinner.start("Distributing commits across date range...");
  let distributedCommits = await distributeCommits(plannedCommits, dateRange);
  spinner.stop();

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
          selected: config.llm.selected,
          providers: config.llm.providers,
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

       console.log(pc.dim("\nRe-analyzing with new prompt...\n"));

       spinner.start("Re-analyzing changes with new prompt...");
      const newAnalysisResult = await analyzeChangesSafe(allFiles, diffs, untrackedContent, untrackedBytes);
      
      if (newAnalysisResult.isErr()) {
        spinner.stop("Re-analysis failed");
        p.log.error(pc.red(formatAIError(newAnalysisResult.error)));
        process.exit(1);
      }
      
      const newAnalysis = newAnalysisResult.value;
      const newCommitGroups = newAnalysis.groups.sort((a, b) => a.order - b.order);

      const newMessages = await generateCommitMessages(
        newCommitGroups.map((g) => ({
          files: g.files
            .map((filePath) => allFiles.find((f) => f.path === filePath))
            .filter((f): f is NonNullable<typeof f> => f !== undefined),
          category: g.category,
          name: g.name,
          description: g.description,
        })),
        recentMessages,
      );

      spinner.stop("Re-analysis complete");

      const newPlannedCommits = buildPlannedCommitsFromAnalysis(newCommitGroups, allFiles, newMessages);

      spinner.start("Distributing commits across date range...");
      const newDistributedCommits = await distributeCommits(newPlannedCommits, dateRange);
      spinner.stop();

      const newPlan: CommitPlan = {
        commits: newDistributedCommits,
        dateRange,
        strategy: "realistic",
        totalFiles: allFiles.length,
        estimatedDuration: `${newAnalysis.suggestedDays} days`,
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
        console.log(renderCommitList(newDistributedCommits));
        const shouldApply = await p.confirm({
          message: "Would you like to apply these commits now?",
          initialValue: false,
        });
        if (p.isCancel(shouldApply) || !shouldApply) {
          p.cancel("Operation cancelled - no changes were made");
          process.exit(0);
        }
      }
      
      // Update distributedCommits for the actual execution
      distributedCommits = newDistributedCommits;
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

  let commitAuthorName: string | undefined;
  let commitAuthorEmail: string | undefined;

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
      commitAuthorName = authorName;
      commitAuthorEmail = authorEmail;
    } else {
      spinner.start("Configuring git identity from chronicle config...");
      await setGitConfig("user.name", authorName, cwd);
      await setGitConfig("user.email", authorEmail, cwd);
      spinner.stop("Git identity configured from chronicle config");
      commitAuthorName = authorName;
      commitAuthorEmail = authorEmail;
    }
  } else {
    spinner.stop("Git identity verified");

    const { name, email } = await getGitIdentity(cwd);
    commitAuthorName = name ?? undefined;
    commitAuthorEmail = email ?? undefined;
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
  let useNoVerifyForRemainingCommits = false;
  let promptedToRetryWithoutHooks = false;
  let fallbackCommitsCreated = 0;
  let fallbackCommitMessages: string[] = [];

  for (let i = 0; i < distributedCommits.length; i++) {
    const commit = distributedCommits[i];
    if (!commit) continue;
    spinner.message(`Commit ${i + 1}/${distributedCommits.length}: ${commit.message}`);

    await unstageAll(cwd);

    let stagedCount = 0;
    
    if (commit.fileHunks && commit.fileHunks.length > 0) {
      // Use hunk indices for precise staging (more reliable than line ranges)
      const result = await stageFileHunksByIndex(commit.fileHunks as FileHunkSpec[], diffs, cwd);
      stagedCount = result.filesStaged.length;

      const hunkPaths = new Set(commit.fileHunks.map((fileHunk) => fileHunk.path));
      const remainingFullFiles = commit.files
        .map((file) => file.path)
        .filter((filePath) => !hunkPaths.has(filePath));

      if (remainingFullFiles.length > 0) {
        const stagedFiles = await stageFiles(remainingFullFiles, cwd);
        stagedCount += stagedFiles.length;
      }
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

    try {
      await createCommit(
        commit.message,
        commit.scheduledDate ?? new Date(),
        commitAuthorName,
        commitAuthorEmail,
        cwd,
        useNoVerifyForRemainingCommits,
      );
      successfulCommits++;
    } catch (error) {
      const commitLabel = `Commit ${i + 1}/${distributedCommits.length}: ${commit.message}`;
      const backupMessage = backupBranch ? `\nBackup branch: ${backupBranch}` : "";
      const errorMessage = formatExecutionError(error);
      const hookFailed = isGitHookError(errorMessage);

      if (hookFailed && !promptedToRetryWithoutHooks) {
        promptedToRetryWithoutHooks = true;
        spinner.stop(`Git hooks failed after ${successfulCommits} commits`);

        p.log.warn(
          `${commitLabel}\n\nGit hooks failed while creating this backfill commit. Chronicle can retry this commit and continue the remaining generated commits without git hooks by using --no-verify.\n\n${errorMessage}${backupMessage}`,
        );

        const retryWithoutHooks = await p.confirm({
          message: "Retry the remaining backfill without git hooks?",
          initialValue: true,
        });

        if (!p.isCancel(retryWithoutHooks) && retryWithoutHooks) {
          useNoVerifyForRemainingCommits = true;
          spinner.start("Retrying commit without git hooks...");
          spinner.message(`Commit ${i + 1}/${distributedCommits.length}: ${commit.message}`);

          try {
            await createCommit(
              commit.message,
              commit.scheduledDate ?? new Date(),
              commitAuthorName,
              commitAuthorEmail,
              cwd,
              true,
            );
            successfulCommits++;
            continue;
          } catch (retryError) {
            await unstageAll(cwd).catch(() => undefined);
            spinner.stop(`Stopped after ${successfulCommits} commits`);

            telemetry.track({
              event: "backfill_executed",
              properties: {
                commits_created: successfulCommits,
                commits_skipped: skippedCommits.length,
                total_files: allFiles.length,
                duration_ms: timer(),
                success: false,
              },
            });

            p.log.error(`${commitLabel}\n\n${formatExecutionError(retryError)}${backupMessage}`);
            return;
          }
        }
      }

      await unstageAll(cwd).catch(() => undefined);
      spinner.stop(`Stopped after ${successfulCommits} commits`);

      telemetry.track({
        event: "backfill_executed",
        properties: {
          commits_created: successfulCommits,
          commits_skipped: skippedCommits.length,
          total_files: allFiles.length,
          duration_ms: timer(),
          success: false,
        },
      });

      p.log.error(`${commitLabel}\n\n${errorMessage}${backupMessage}`);
      return;
    }
  }

  let remainingChangedFiles = await getRemainingChangedFiles(cwd);
  if (remainingChangedFiles.length > 0) {
    spinner.message("Including remaining changes with fallback commits...");

    const fallbackStartDate =
      distributedCommits[distributedCommits.length - 1]?.scheduledDate ?? new Date();
    const fallbackResult = await createFallbackCommitsForRemainingChanges({
      cwd,
      commitAuthorName,
      commitAuthorEmail,
      noVerify: useNoVerifyForRemainingCommits,
      startDate: fallbackStartDate,
    });

    fallbackCommitsCreated = fallbackResult.created;
    fallbackCommitMessages = fallbackResult.messages;
    remainingChangedFiles = fallbackResult.remainingFiles;

    if (fallbackResult.error) {
      spinner.stop(`Stopped after ${successfulCommits + fallbackCommitsCreated} commits`);

      telemetry.track({
        event: "backfill_executed",
        properties: {
          commits_created: successfulCommits + fallbackCommitsCreated,
          commits_skipped: skippedCommits.length,
          total_files: allFiles.length,
          duration_ms: timer(),
          success: false,
        },
      });

      const backupMessage = backupBranch ? `\nBackup branch: ${backupBranch}` : "";
      p.log.error(
        `Fallback commit failed\n\n${formatExecutionError(fallbackResult.error)}${backupMessage}`,
      );
      return;
    }
  }

  if (remainingChangedFiles.length > 0) {
    spinner.stop(`Stopped after ${successfulCommits + fallbackCommitsCreated} commits`);

    telemetry.track({
      event: "backfill_executed",
      properties: {
        commits_created: successfulCommits + fallbackCommitsCreated,
        commits_skipped: skippedCommits.length,
        total_files: allFiles.length,
        duration_ms: timer(),
        success: false,
      },
    });

    const backupMessage = backupBranch ? `\nBackup branch: ${backupBranch}` : "";
    p.log.error(
      `Backfill completed with remaining changes\n\nChronicle attempted deterministic fallback commits, but these files still have changes: ${remainingChangedFiles.map((file) => file.path).join(", ")}${backupMessage}`,
    );
    return;
  }

  successfulCommits += fallbackCommitsCreated;

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

  if (fallbackCommitMessages.length > 0) {
    resultMessage += pc.yellow(
      `\n\n   ⚠️  Added ${fallbackCommitMessages.length} fallback commit${fallbackCommitMessages.length === 1 ? "" : "s"} for remaining changes:`,
    );
    for (const msg of fallbackCommitMessages.slice(0, 3)) {
      resultMessage += pc.dim(`\n      - ${msg}`);
    }
    if (fallbackCommitMessages.length > 3) {
      resultMessage += pc.dim(`\n      ... and ${fallbackCommitMessages.length - 3} more`);
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

export const __internal = {
  buildFallbackCommitMessage,
  getMinimumSuggestedTimelineDays,
  dedupeChangedFiles,
  getRemainingChangedFiles,
  createFallbackCommitsForRemainingChanges,
};
