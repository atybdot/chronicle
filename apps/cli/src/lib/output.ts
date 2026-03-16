import pc from "picocolors";
import type { PlannedCommit, CommitPlan } from "../types";
import { getDistributionStats } from "./distribution";

/**
 * Render ASCII commit graph
 */
export function renderCommitGraph(commits: PlannedCommit[]): string {
  const sortedCommits = [...commits].sort((a, b) => {
    if (!a.scheduledDate || !b.scheduledDate) return 0;
    return a.scheduledDate.getTime() - b.scheduledDate.getTime();
  });

  const lines: string[] = [];
  lines.push(pc.bold("\n📊 Commit Graph Preview\n"));

  // Group commits by date
  const byDate = new Map<string, PlannedCommit[]>();
  for (const commit of sortedCommits) {
    if (!commit.scheduledDate) continue;
    const dateKey = commit.scheduledDate.toDateString();
    if (!byDate.has(dateKey)) {
      byDate.set(dateKey, []);
    }
    byDate.get(dateKey)!.push(commit);
  }

  // Render each date
  for (const [dateKey, dateCommits] of byDate) {
    const date = new Date(dateKey);
    const dayName = date.toLocaleDateString("en-US", { weekday: "short" });
    const dateStr = date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });

    lines.push(pc.dim(`${dayName} ${dateStr}`));

    for (let i = 0; i < dateCommits.length; i++) {
      const commit = dateCommits[i];
      if (!commit) continue;
      const isLast = i === dateCommits.length - 1;
      const connector = isLast ? "└" : "├";
      const time = commit.scheduledDate?.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });

      const categoryColor = getCategoryColor(commit.category);
      const categoryIcon = getCategoryIcon(commit.category);

      lines.push(
        `  ${pc.dim(connector)}─ ${pc.dim(time ?? "")} ${categoryColor(categoryIcon)} ${pc.white(commit.message)}`,
      );

      // Show files for this commit
      if (commit.files.length > 0) {
        const fileList = commit.files.map((f) => f.path).join(", ");
        const truncatedFiles = fileList.length > 60 ? fileList.substring(0, 57) + "..." : fileList;
        lines.push(`      ${pc.dim("└─ Files:")} ${pc.dim(truncatedFiles)}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Render GitHub-style contribution graph preview
 */
export function renderContributionGraph(commits: PlannedCommit[]): string {
  const lines: string[] = [];
  lines.push(pc.bold("\n📅 GitHub Contribution Preview\n"));

  // Get date range
  const dates = commits
    .map((c) => c.scheduledDate)
    .filter((d): d is Date => d !== undefined)
    .sort((a, b) => a.getTime() - b.getTime());

  if (dates.length === 0) {
    return lines.join("\n") + pc.dim("  No scheduled commits\n");
  }

  // Build contribution map
  const contributions = new Map<string, number>();
  for (const commit of commits) {
    if (!commit.scheduledDate) continue;
    const key = commit.scheduledDate.toISOString().split("T")[0] ?? "";
    contributions.set(key, (contributions.get(key) ?? 0) + 1);
  }

  // Find max for scaling
  const maxContributions = Math.max(...contributions.values());

  // Get the week range
  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];

  if (!firstDate || !lastDate) {
    return lines.join("\n") + pc.dim("  No scheduled commits\n");
  }

  const startDate = new Date(firstDate);
  startDate.setDate(startDate.getDate() - startDate.getDay()); // Start from Sunday

  const endDate = new Date(lastDate);
  endDate.setDate(endDate.getDate() + (6 - endDate.getDay())); // End on Saturday

  // Render calendar
  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  lines.push("      " + pc.dim(dayLabels.join(" ")));

  // Render weeks
  const weeks: string[][] = [];
  const current = new Date(startDate);

  while (current <= endDate) {
    const weekStart = new Date(current);
    const week: string[] = [];

    for (let day = 0; day < 7; day++) {
      const dateKey = current.toISOString().split("T")[0] ?? "";
      const count = contributions.get(dateKey) ?? 0;
      week.push(getContributionCell(count, maxContributions));
      current.setDate(current.getDate() + 1);
    }

    // Add week label (month/day of first day)
    const weekLabel = weekStart.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    weeks.push([pc.dim(weekLabel.padStart(6)), ...week]);
  }

  for (const week of weeks) {
    lines.push(week.join(" "));
  }

  // Legend
  lines.push("");
  lines.push(
    pc.dim("  Less ") +
      getContributionCell(0, 4) +
      " " +
      getContributionCell(1, 4) +
      " " +
      getContributionCell(2, 4) +
      " " +
      getContributionCell(3, 4) +
      " " +
      getContributionCell(4, 4) +
      pc.dim(" More"),
  );

  return lines.join("\n");
}

/**
 * Render commit plan summary
 */
export function renderPlanSummary(plan: CommitPlan): string {
  const stats = getDistributionStats(plan.commits);
  const lines: string[] = [];

  lines.push(pc.bold("\n📋 Commit Plan Summary\n"));

  lines.push(`  ${pc.cyan("Total commits:")} ${plan.commits.length}`);
  lines.push(`  ${pc.cyan("Total files:")} ${plan.totalFiles}`);
  lines.push(
    `  ${pc.cyan("Date range:")} ${plan.dateRange.start.toLocaleDateString()} - ${plan.dateRange.end.toLocaleDateString()}`,
  );
  lines.push(`  ${pc.cyan("Days:")} ${stats.totalDays}`);
  lines.push(`  ${pc.cyan("Avg commits/day:")} ${stats.avgPerDay.toFixed(1)}`);
  lines.push(`  ${pc.cyan("Strategy:")} ${plan.strategy}`);

  // Category breakdown
  const byCategory = new Map<string, number>();
  for (const commit of plan.commits) {
    byCategory.set(commit.category, (byCategory.get(commit.category) ?? 0) + 1);
  }

  lines.push(`\n  ${pc.bold("By category:")}`);
  for (const [category, count] of byCategory) {
    const color = getCategoryColor(category);
    const icon = getCategoryIcon(category);
    lines.push(`    ${color(icon)} ${category}: ${count}`);
  }

  // Day of week breakdown
  if (Object.keys(stats.byDayOfWeek).length > 0) {
    lines.push(`\n  ${pc.bold("By day of week:")}`);
    for (const [day, count] of Object.entries(stats.byDayOfWeek)) {
      const bar = "█".repeat(Math.ceil(count / 2)) + "░".repeat(10 - Math.ceil(count / 2));
      lines.push(`    ${day.padEnd(10)} ${pc.green(bar)} ${count}`);
    }
  }

  return lines.join("\n");
}

/**
 * Render detailed commit list
 */
export function renderCommitList(commits: PlannedCommit[]): string {
  const lines: string[] = [];
  lines.push(pc.bold("\n📝 Commit Details\n"));

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];
    if (!commit) continue;
    const categoryColor = getCategoryColor(commit.category);
    const categoryIcon = getCategoryIcon(commit.category);

    lines.push(`${pc.dim(`${i + 1}.`)} ${categoryColor(categoryIcon)} ${pc.bold(commit.message)}`);

    if (commit.description) {
      lines.push(`   ${pc.dim(commit.description)}`);
    }

    lines.push(`   ${pc.dim("Files:")} ${commit.files.map((f) => f.path).join(", ")}`);

    if (commit.scheduledDate) {
      lines.push(`   ${pc.dim("Scheduled:")} ${commit.scheduledDate.toLocaleString()}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Export plan as JSON
 */
export function exportPlanAsJson(plan: CommitPlan): string {
  return JSON.stringify(
    plan,
    (key, value) => {
      if (value instanceof Date) {
        return value.toISOString();
      }
      return value;
    },
    2,
  );
}

// Helper functions
function getCategoryColor(category: string): (text: string) => string {
  switch (category) {
    case "feature":
      return pc.green;
    case "fix":
      return pc.red;
    case "refactor":
      return pc.yellow;
    case "docs":
      return pc.blue;
    case "test":
      return pc.magenta;
    case "chore":
      return pc.gray;
    case "style":
      return pc.cyan;
    case "setup":
      return pc.white;
    default:
      return pc.white;
  }
}

function getCategoryIcon(category: string): string {
  switch (category) {
    case "feature":
      return "✨";
    case "fix":
      return "🐛";
    case "refactor":
      return "♻️";
    case "docs":
      return "📚";
    case "test":
      return "🧪";
    case "chore":
      return "🔧";
    case "style":
      return "💅";
    case "setup":
      return "🎉";
    default:
      return "📝";
  }
}

function getContributionCell(count: number, max: number): string {
  if (count === 0) return pc.dim("░");

  const intensity = count / max;
  if (intensity > 0.75) return pc.green("█");
  if (intensity > 0.5) return pc.green("▓");
  if (intensity > 0.25) return pc.green("▒");
  return pc.green("░");
}
