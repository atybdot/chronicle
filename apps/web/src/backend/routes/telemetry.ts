import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { sql, gte, and, countDistinct } from "drizzle-orm";
import { rateLimiter, type Store } from "hono-rate-limiter";
import type { KVNamespace } from "@cloudflare/workers-types";
import {
  createDb,
  events,
  trackEventSchema,
  batchEventsSchema,
  type Database,
  type TrackEventInput,
} from "../db";
import type { StatsData } from "@/types/stats";

// Cache duration: 5 minutes
const STATS_CACHE_SECONDS = 300;

// WorkersKVStore class - lazy loaded to avoid Node.js crash in dev mode
// The @hono-rate-limiter/cloudflare package imports cloudflare:workers which doesn't exist in Node
let WorkersKVStore: new (opts: { namespace: KVNamespace; prefix?: string }) => Store | null = null;
let storeLoadPromise: Promise<void> | null = null;

async function loadWorkersKVStore(): Promise<void> {
  if (WorkersKVStore) return;
  if (storeLoadPromise) return storeLoadPromise;

  storeLoadPromise = (async () => {
    try {
      const mod = await import("@hono-rate-limiter/cloudflare");
      WorkersKVStore = mod.WorkersKVStore;
    } catch {
      // Running in Node.js (astro dev) - cloudflare:workers not available
      WorkersKVStore = null;
    }
  })();

  return storeLoadPromise;
}

// Use CloudflareBindings from wrangler types
const telemetry = new Hono<{ Bindings: CloudflareBindings }>();

/**
 * POST /track - Track a single event
 */
telemetry.post("/track", zValidator("json", trackEventSchema), async (c) => {
  const event = c.req.valid("json");
  const db = createDb(c.env.DB);
  await insertEvent(db, event);

  return c.json({ success: true });
});

/**
 * POST /batch - Track multiple events
 */
telemetry.post("/batch", zValidator("json", batchEventsSchema), async (c) => {
  const { events: eventList } = c.req.valid("json");
  const db = createDb(c.env.DB);

  await insertEvents(db, eventList);

  return c.json({ success: true, processed: eventList.length });
});

/**
 * GET /health - Health check
 */
telemetry.get("/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /stats - Get telemetry statistics (rate limited, cached)
 * Rate limit: 30 requests per minute per IP
 */
telemetry.get(
  "/stats",
  async (c, next) => {
    // Apply rate limiting only if KV is available
    if (!c.env.RATE_LIMIT_KV) {
      return next();
    }

    // Lazy load WorkersKVStore (not available in Node.js dev mode)
    await loadWorkersKVStore();
    if (!WorkersKVStore) {
      // Skip rate limiting in dev mode when cloudflare:workers isn't available
      return next();
    }

    return rateLimiter<{ Bindings: CloudflareBindings }>({
      windowMs: 60 * 1000, // 1 minute
      limit: 30, // 30 requests per minute
      standardHeaders: "draft-6",
      keyGenerator: (c) => c.req.header("cf-connecting-ip") ?? "anonymous",
      store: new WorkersKVStore({ namespace: c.env.RATE_LIMIT_KV, prefix: "rl_" }),
    })(c, next);
  },
  async (c) => {
    const days = parseInt(c.req.query("days") || "7", 10);
    const cacheKey = `cache:stats:days:${days}`;

    // Check cache if KV is available
    if (c.env.RATE_LIMIT_KV) {
      const cached = await c.env.RATE_LIMIT_KV.get(cacheKey, "json");
      if (cached) {
        c.header("X-Cache", "HIT");
        return c.json(cached);
      }
    }

    const db = createDb(c.env.DB);
    const stats = await getStats(db, days);

    // Cache the response if KV is available
    if (c.env.RATE_LIMIT_KV) {
      await c.env.RATE_LIMIT_KV.put(cacheKey, JSON.stringify(stats), {
        expirationTtl: STATS_CACHE_SECONDS,
      });
      c.header("X-Cache", "MISS");
    }

    return c.json(stats);
  },
);

// ============================================================================
// Database Operations
// ============================================================================

async function insertEvent(db: Database, event: TrackEventInput): Promise<void> {
  await db.insert(events).values({
    eventName: event.event,
    anonymousId: event.anonymousId,
    timestamp: event.timestamp || new Date().toISOString(),
    properties: JSON.stringify(event.properties || {}),
    cliVersion: event.context?.cli_version,
    osType: event.context?.os_type,
    isCi: event.context?.is_ci ?? false,
  });
}

async function insertEvents(db: Database, eventList: TrackEventInput[]): Promise<void> {
  if (eventList.length === 0) return;

  const values = eventList.map((event) => ({
    eventName: event.event,
    anonymousId: event.anonymousId,
    timestamp: event.timestamp || new Date().toISOString(),
    properties: JSON.stringify(event.properties || {}),
    cliVersion: event.context?.cli_version,
    osType: event.context?.os_type,
    isCi: event.context?.is_ci ?? false,
  }));

  await db.insert(events).values(values);
}

async function getStats(db: Database, days: number): Promise<StatsData> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString();

  // Run all queries in parallel
  const [
    uniqueUsers,
    backfillStats,
    aiProviderStats,
    activityByDay,
    commandStats,
    dateRangeStats,
    modelCategoryStats,
  ] = await Promise.all([
    // Unique users (from any event)
    db
      .select({ count: countDistinct(events.anonymousId) })
      .from(events)
      .where(gte(events.timestamp, sinceStr))
      .then((r) => r[0]?.count ?? 0),

    // Backfill stats: commits created, files processed, success rate
    // Extract from backfill_executed event properties (JSON)
    db
      .select({
        properties: events.properties,
      })
      .from(events)
      .where(and(gte(events.timestamp, sinceStr), sql`${events.eventName} = 'backfill_executed'`))
      .then((rows) => {
        let totalCommits = 0;
        let totalFiles = 0;
        let successCount = 0;
        let totalBackfills = rows.length;

        for (const row of rows) {
          try {
            const props = JSON.parse(row.properties);
            totalCommits += props.commits_created ?? 0;
            totalFiles += props.total_files ?? 0;
            if (props.success) successCount++;
          } catch {
            // Skip malformed JSON
          }
        }

        return {
          total_backfills: totalBackfills,
          total_commits: totalCommits,
          total_files: totalFiles,
          success_rate: totalBackfills > 0 ? Math.round((successCount / totalBackfills) * 100) : 0,
        };
      }),

    // AI provider usage from ai_request_made events
    db
      .select({
        properties: events.properties,
      })
      .from(events)
      .where(and(gte(events.timestamp, sinceStr), sql`${events.eventName} = 'ai_request_made'`))
      .then((rows) => {
        const providers: Record<string, number> = {};
        let cacheHits = 0;
        let totalRequests = rows.length;

        for (const row of rows) {
          try {
            const props = JSON.parse(row.properties);
            const provider = props.provider ?? "unknown";
            providers[provider] = (providers[provider] ?? 0) + 1;
            if (props.cache_hit) cacheHits++;
          } catch {
            // Skip malformed JSON
          }
        }

        return {
          by_provider: providers,
          total_requests: totalRequests,
          cache_hit_rate:
            totalRequests > 0 ? Math.round((cacheHits / totalRequests) * 100) : 0,
        };
      }),

    // Daily activity: backfills and commits per day
    db
      .select({
        date: sql<string>`date(${events.timestamp})`,
        properties: events.properties,
      })
      .from(events)
      .where(and(gte(events.timestamp, sinceStr), sql`${events.eventName} = 'backfill_executed'`))
      .orderBy(sql`date(${events.timestamp})`)
      .then((rows) => {
        const byDay: Record<string, { backfills: number; commits: number }> = {};

        for (const row of rows) {
          const date = row.date;
          if (!byDay[date]) byDay[date] = { backfills: 0, commits: 0 };
          byDay[date].backfills++;

          try {
            const props = JSON.parse(row.properties);
            byDay[date].commits += props.commits_created ?? 0;
          } catch {
            // Skip malformed JSON
          }
        }

        return Object.entries(byDay)
          .map(([date, data]) => ({ date, ...data }))
          .sort((a, b) => a.date.localeCompare(b.date));
      }),

    // Command usage stats (excluding help command)
    db
      .select({
        properties: events.properties,
      })
      .from(events)
      .where(and(gte(events.timestamp, sinceStr), sql`${events.eventName} = 'command_invoked'`))
      .then((rows) => {
        const commands: Record<string, number> = {};

        for (const row of rows) {
          try {
            const props = JSON.parse(row.properties);
            const cmd = props.command ?? "unknown";
            // Skip help command as it's not meaningful for stats
            if (cmd !== "help") {
              commands[cmd] = (commands[cmd] ?? 0) + 1;
            }
          } catch {
            // Skip malformed JSON
          }
        }

        return commands;
      }),

    // Date range distribution from backfill_plan_generated events
    db
      .select({
        properties: events.properties,
      })
      .from(events)
      .where(and(gte(events.timestamp, sinceStr), sql`${events.eventName} = 'backfill_plan_generated'`))
      .then((rows) => {
        const ranges: Record<string, number> = {};

        for (const row of rows) {
          try {
            const props = JSON.parse(row.properties);
            const days = props.date_range_days;
            if (days !== undefined) {
              // Normalize to days (convert weeks/months to days)
              let rangeLabel: string;
              if (days <= 7) rangeLabel = "1-7 days";
              else if (days <= 14) rangeLabel = "8-14 days";
              else if (days <= 30) rangeLabel = "15-30 days";
              else if (days <= 60) rangeLabel = "31-60 days";
              else if (days <= 90) rangeLabel = "61-90 days";
              else rangeLabel = "90+ days";
              ranges[rangeLabel] = (ranges[rangeLabel] ?? 0) + 1;
            }
          } catch {
            // Skip malformed JSON
          }
        }

        return ranges;
      }),

    // Model category distribution from ai_request_made events
    db
      .select({
        properties: events.properties,
      })
      .from(events)
      .where(and(gte(events.timestamp, sinceStr), sql`${events.eventName} = 'ai_request_made'`))
      .then((rows) => {
        const categories: Record<string, number> = {};

        for (const row of rows) {
          try {
            const props = JSON.parse(row.properties);
            const category = props.model_category ?? "unknown";
            categories[category] = (categories[category] ?? 0) + 1;
          } catch {
            // Skip malformed JSON
          }
        }

        return categories;
      }),
  ]);

  return {
    // Key metrics
    unique_users: uniqueUsers,
    total_commits: backfillStats.total_commits,
    total_files: backfillStats.total_files,
    total_backfills: backfillStats.total_backfills,

    // AI usage
    ai_providers: aiProviderStats.by_provider,
    ai_requests: aiProviderStats.total_requests,

    // Activity over time
    activity_by_day: activityByDay,

    // Breakdown stats
    commands: commandStats,
    date_ranges: dateRangeStats,
    model_categories: modelCategoryStats,
  };
}

export { telemetry, getStats };
