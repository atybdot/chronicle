import type { PlannedCommit } from "../types";
import { loadConfig } from "./config";

export type DistributionStrategy = "realistic" | "even" | "custom";

interface DistributionOptions {
  strategy: DistributionStrategy;
  workHoursStart?: number;
  workHoursEnd?: number;
  excludeWeekends?: boolean;
  customSchedule?: Date[];
}

/**
 * Distribute commits across a date range with realistic patterns
 */
export async function distributeCommits(
  commits: PlannedCommit[],
  dateRange: { start: Date; end: Date },
  options?: Partial<DistributionOptions>,
): Promise<PlannedCommit[]> {
  const config = await loadConfig();
  const strategy = options?.strategy ?? config.defaults.distribution;

  switch (strategy) {
    case "realistic":
      return distributeRealistic(commits, dateRange, {
        workHoursStart: options?.workHoursStart ?? config.defaults.workHoursStart,
        workHoursEnd: options?.workHoursEnd ?? config.defaults.workHoursEnd,
        excludeWeekends: options?.excludeWeekends ?? config.defaults.excludeWeekends,
      });
    case "even":
      return distributeEvenly(commits, dateRange);
    case "custom":
      if (options?.customSchedule) {
        return distributeCustom(commits, options.customSchedule);
      }
      return distributeEvenly(commits, dateRange);
    default:
      return distributeRealistic(commits, dateRange, {
        workHoursStart: config.defaults.workHoursStart,
        workHoursEnd: config.defaults.workHoursEnd,
        excludeWeekends: config.defaults.excludeWeekends,
      });
  }
}

/**
 * Distribute commits with realistic work patterns
 * - More commits on weekdays
 * - Commits during work hours with some variance
 * - Natural clustering (multiple commits in a session)
 */
function distributeRealistic(
  commits: PlannedCommit[],
  dateRange: { start: Date; end: Date },
  options: {
    workHoursStart: number;
    workHoursEnd: number;
    excludeWeekends: boolean;
  },
): PlannedCommit[] {
  const { start, end } = dateRange;
  const { workHoursStart, workHoursEnd, excludeWeekends } = options;

  // Get available days
  const availableDays: Date[] = [];
  const current = new Date(start);

  while (current <= end) {
    const dayOfWeek = current.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    if (!excludeWeekends || !isWeekend) {
      availableDays.push(new Date(current));
    }
    current.setDate(current.getDate() + 1);
  }

  if (availableDays.length === 0) {
    throw new Error("No available days in the specified range");
  }

  // Calculate commits per day with variance
  // Some days have more commits (coding sessions), some have fewer
  const totalCommits = commits.length;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _avgCommitsPerDay = totalCommits / availableDays.length;

  // Generate day weights (some days are more productive)
  const dayWeights = availableDays.map((day) => {
    const dayOfWeek = day.getDay();
    // Midweek is typically more productive
    const baseWeight =
      dayOfWeek === 2 || dayOfWeek === 3 ? 1.3 : dayOfWeek === 1 || dayOfWeek === 4 ? 1.1 : 0.7;
    // Add some randomness
    return baseWeight * (0.8 + Math.random() * 0.4);
  });

  // Normalize weights
  const totalWeight = dayWeights.reduce((a, b) => a + b, 0);
  const normalizedWeights = dayWeights.map((w) => w / totalWeight);

  // Assign commits to days based on weights
  const commitsPerDay: number[] = Array.from({ length: availableDays.length }, () => 0);
  let assignedCommits = 0;

  for (let i = 0; i < availableDays.length && assignedCommits < totalCommits; i++) {
    const weight = normalizedWeights[i];
    if (weight === undefined) continue;
    const expectedCommits = Math.round(weight * totalCommits);
    const actualCommits = Math.min(expectedCommits, totalCommits - assignedCommits);
    commitsPerDay[i] = actualCommits;
    assignedCommits += actualCommits;
  }

  // Distribute remaining commits
  while (assignedCommits < totalCommits) {
    const randomDay = Math.floor(Math.random() * availableDays.length);
    const current = commitsPerDay[randomDay];
    if (current !== undefined) {
      commitsPerDay[randomDay] = current + 1;
    }
    assignedCommits++;
  }

  // Assign timestamps to commits
  let commitIndex = 0;
  const result: PlannedCommit[] = [];

  for (let dayIndex = 0; dayIndex < availableDays.length; dayIndex++) {
    const day = availableDays[dayIndex];
    const numCommits = commitsPerDay[dayIndex] ?? 0;

    if (!day || numCommits === 0) continue;

    // Generate timestamps for this day's commits
    // Simulate coding sessions with clustered commits
    const timestamps = generateDayTimestamps(day, numCommits, workHoursStart, workHoursEnd);

    for (const timestamp of timestamps) {
      const commit = commits[commitIndex];
      if (commitIndex >= commits.length || !commit) break;
      result.push({
        ...commit,
        scheduledDate: timestamp,
      });
      commitIndex++;
    }
  }

  return result;
}

/**
 * Generate realistic timestamps within a day
 */
function generateDayTimestamps(
  day: Date,
  count: number,
  workStart: number,
  workEnd: number,
): Date[] {
  const timestamps: Date[] = [];
  const workMinutes = (workEnd - workStart) * 60;

  // Create clusters of commits (simulating coding sessions)
  const numSessions = Math.ceil(count / 3); // ~3 commits per session on average
  const sessionStarts: number[] = [];

  for (let i = 0; i < numSessions; i++) {
    // Random session start within work hours
    const sessionStart = Math.floor(Math.random() * (workMinutes - 60));
    sessionStarts.push(sessionStart);
  }
  sessionStarts.sort((a, b) => a - b);

  // Distribute commits across sessions
  let sessionIndex = 0;
  let commitsInCurrentSession = 0;

  for (let i = 0; i < count; i++) {
    const session = sessionStarts[sessionIndex] ?? 0;
    // Add some minutes within the session (commits within 30 min of session start)
    const offsetMinutes = commitsInCurrentSession * (5 + Math.floor(Math.random() * 10));

    const timestamp = new Date(day);
    timestamp.setHours(workStart, 0, 0, 0);
    timestamp.setMinutes(timestamp.getMinutes() + session + offsetMinutes);

    // Add some seconds for realism
    timestamp.setSeconds(Math.floor(Math.random() * 60));

    timestamps.push(timestamp);

    commitsInCurrentSession++;
    if (commitsInCurrentSession >= 3 && sessionIndex < sessionStarts.length - 1) {
      sessionIndex++;
      commitsInCurrentSession = 0;
    }
  }

  return timestamps.sort((a, b) => a.getTime() - b.getTime());
}

/**
 * Distribute commits evenly across the date range
 */
function distributeEvenly(
  commits: PlannedCommit[],
  dateRange: { start: Date; end: Date },
): PlannedCommit[] {
  const { start, end } = dateRange;
  const totalMs = end.getTime() - start.getTime();
  const interval = totalMs / commits.length;

  return commits.map((commit, index) => ({
    ...commit,
    scheduledDate: new Date(start.getTime() + interval * index + Math.random() * interval * 0.5),
  }));
}

/**
 * Distribute commits according to custom schedule
 */
function distributeCustom(commits: PlannedCommit[], schedule: Date[]): PlannedCommit[] {
  if (schedule.length < commits.length) {
    throw new Error(
      `Custom schedule has ${schedule.length} dates but there are ${commits.length} commits`,
    );
  }

  return commits.map((commit, index) => {
    const scheduleDate = schedule[index];
    if (!scheduleDate) {
      throw new Error(`Missing schedule date for commit at index ${index}`);
    }
    return {
      ...commit,
      scheduledDate: scheduleDate,
    };
  });
}

/**
 * Calculate suggested number of days based on commit count
 */
export function suggestDaysForCommits(commitCount: number, avgCommitsPerDay = 4): number {
  return Math.max(1, Math.ceil(commitCount / avgCommitsPerDay));
}

/**
 * Get statistics about the distribution
 */
export function getDistributionStats(commits: PlannedCommit[]): {
  totalCommits: number;
  totalDays: number;
  avgPerDay: number;
  dateRange: { start: Date; end: Date };
  byDayOfWeek: Record<string, number>;
} {
  const dates = commits.map((c) => c.scheduledDate).filter((d): d is Date => d !== undefined);

  if (dates.length === 0) {
    return {
      totalCommits: commits.length,
      totalDays: 0,
      avgPerDay: 0,
      dateRange: { start: new Date(), end: new Date() },
      byDayOfWeek: {},
    };
  }

  const sortedDates = dates.sort((a, b) => a.getTime() - b.getTime());
  const uniqueDays = new Set(sortedDates.map((d) => d.toDateString()));

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const byDayOfWeek: Record<string, number> = {};

  for (const date of dates) {
    const dayName = dayNames[date.getDay()];
    if (dayName) {
      byDayOfWeek[dayName] = (byDayOfWeek[dayName] ?? 0) + 1;
    }
  }

  const firstDate = sortedDates[0];
  const lastDate = sortedDates[sortedDates.length - 1];

  return {
    totalCommits: commits.length,
    totalDays: uniqueDays.size,
    avgPerDay: commits.length / uniqueDays.size,
    dateRange: {
      start: firstDate ?? new Date(),
      end: lastDate ?? new Date(),
    },
    byDayOfWeek,
  };
}
