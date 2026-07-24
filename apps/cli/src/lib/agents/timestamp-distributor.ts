import type { CommitGroup, CommitMessage, TimestampAssignment } from "../../types";

type DateRange = {
  start: string;
  end: string;
};

type TemporalPattern = {
  suggestedWorkHours: { start: number; end: number };
  excludeWeekends: boolean;
  clusterCommits: boolean;
};

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function isWithinWorkHours(date: Date, startHour: number, endHour: number): boolean {
  const hour = date.getUTCHours();
  return hour >= startHour && hour < endHour;
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function getTimezoneOffset(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const hours = Math.floor(Math.abs(offset) / 60);
  const minutes = Math.abs(offset) % 60;
  const sign = offset >= 0 ? "+" : "-";
  return `${sign}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function generateTimestamp(
  dateRange: DateRange,
  workHours: { start: number; end: number },
  excludeWeekends: boolean
): Date {
  const start = new Date(dateRange.start);
  const end = new Date(dateRange.end);
  
  const startTime = start.getTime();
  const endTime = end.getTime();
  let randomTime = startTime + Math.random() * (endTime - startTime);
  let date = new Date(randomTime);
  
  if (!isWithinWorkHours(date, workHours.start, workHours.end)) {
    const hour = randomBetween(workHours.start, workHours.end - 1);
    const minute = randomBetween(0, 59);
    date.setUTCHours(hour, minute, 0, 0);
  }
  
  if (excludeWeekends && isWeekend(date)) {
    const daysUntilMonday = (8 - date.getUTCDay()) % 7 || 7;
    date.setUTCDate(date.getUTCDate() + daysUntilMonday);
    const hour = randomBetween(workHours.start, workHours.end - 1);
    const minute = randomBetween(0, 59);
    date.setUTCHours(hour, minute, 0, 0);
  }
  
  return date;
}

function sortByDependencies(groups: CommitGroup[]): CommitGroup[] {
  const sorted: CommitGroup[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  
  function visit(group: CommitGroup) {
    if (visited.has(group.id)) return;
    if (visiting.has(group.id)) return;
    
    visiting.add(group.id);
    
    for (const depId of group.dependencies) {
      const dep = groups.find(g => g.id === depId);
      if (dep) visit(dep);
    }
    
    visiting.delete(group.id);
    visited.add(group.id);
    sorted.push(group);
  }
  
  for (const group of groups) {
    visit(group);
  }
  
  return sorted;
}

function addSpacing(
  timestamps: TimestampAssignment[],
  clusterCommits: boolean,
  dateRange: DateRange
): TimestampAssignment[] {
  if (timestamps.length <= 1) return timestamps;
  
  const startTime = new Date(dateRange.start).getTime();
  const endTime = new Date(dateRange.end).getTime();
  
  const sorted = [...timestamps].sort(
    (a, b) => new Date(a.commitDate).getTime() - new Date(b.commitDate).getTime()
  );
  
  const result: TimestampAssignment[] = [sorted[0]!];
  
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const curr = sorted[i]!;
    
    const prevDate = new Date(prev.commitDate);
    const currDate = new Date(curr.commitDate);
    
    const diffMinutes = (currDate.getTime() - prevDate.getTime()) / (1000 * 60);
    
    let newDate: Date;
    
    if (clusterCommits) {
      // Within same feature: 2-15 minutes apart
      if (diffMinutes < 2 || diffMinutes > 15) {
        const spacing = randomBetween(2, 15);
        newDate = new Date(prevDate.getTime() + spacing * 60 * 1000);
      } else {
        newDate = currDate;
      }
    } else {
      // Between unrelated features: 1-3 days gap
      if (diffMinutes < 60 * 24) {
        const spacingDays = randomBetween(1, 3);
        newDate = new Date(prevDate.getTime() + spacingDays * 24 * 60 * 60 * 1000);
      } else {
        newDate = currDate;
      }
    }
    
    // Clamp to date range
    if (newDate.getTime() > endTime) {
      newDate = new Date(endTime);
    }
    
    curr.commitDate = newDate.toISOString();
    curr.authorDate = newDate.toISOString();
    result.push(curr);
  }
  
  return result;
}

export const TimestampDistributor = {
  async distribute_timestamps(
    groups: CommitGroup[],
    messages: CommitMessage[],
    intent: string,
    dateRange: DateRange
  ): Promise<{ timestamps: TimestampAssignment[] }> {
    const pattern = await TimestampDistributor.analyze_temporal_patterns(dateRange, intent);
    const sortedGroups = sortByDependencies(groups);
    
    const timestamps: TimestampAssignment[] = [];
    const sessionIds = new Map<string, string>();
    
    for (const group of sortedGroups) {
      const date = generateTimestamp(dateRange, pattern.suggestedWorkHours, pattern.excludeWeekends);
      
      if (!sessionIds.has(group.id)) {
        sessionIds.set(group.id, generateSessionId());
      }
      
      const commitDate = date.toISOString();
      const authorDate = date.toISOString();
      const commitDateTz = getTimezoneOffset(date);
      const authorDateTz = getTimezoneOffset(date);
      
      timestamps.push({
        groupId: group.id,
        commitDate,
        authorDate,
        commitDateTz,
        authorDateTz,
        sessionId: sessionIds.get(group.id)!,
      });
    }
    
    const spacedTimestamps = addSpacing(timestamps, pattern.clusterCommits, dateRange);
    
    return { timestamps: spacedTimestamps };
  },

  async analyze_temporal_patterns(
    dateRange: DateRange,
    intent: string
  ): Promise<TemporalPattern> {
    const intentLower = intent.toLowerCase();
    
    let pattern: TemporalPattern = {
      suggestedWorkHours: { start: 9, end: 18 },
      excludeWeekends: true,
      clusterCommits: false,
    };
    
    if (intentLower.includes("cleanup") || intentLower.includes("clean up")) {
      pattern.excludeWeekends = false;
    }
    
    if (intentLower.includes("bug fix") || intentLower.includes("bugfix") || intentLower.includes("fix")) {
      pattern.clusterCommits = true;
    }
    
    if (intentLower.includes("weekend")) {
      pattern.excludeWeekends = false;
    }
    
    if (intentLower.includes("night") || intentLower.includes("after hours")) {
      pattern.suggestedWorkHours = { start: 18, end: 23 };
    }
    
    return pattern;
  },
};