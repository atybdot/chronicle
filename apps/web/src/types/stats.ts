/**
 * Stats data structure returned by getStats()
 * Public-facing stats (no admin metrics like success_rate, cache_hit_rate)
 */
export interface StatsData {
  // Key metrics
  unique_users: number;
  total_commits: number;
  total_files: number;
  total_backfills: number;

  // AI usage
  ai_providers: Record<string, number>;
  ai_requests: number;

  // Activity over time
  activity_by_day: { date: string; backfills: number; commits: number }[];

  // Breakdown stats
  commands: Record<string, number>;
  date_ranges: Record<string, number>;
  model_categories: Record<string, number>;
}
