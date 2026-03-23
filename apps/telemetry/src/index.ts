import { Hono } from "hono";
import { cors } from "hono/cors";
import { zValidator } from "@hono/zod-validator";
import { sql, gte, and, countDistinct } from "drizzle-orm";
import { rateLimiter, type Store } from "hono-rate-limiter";
import { WorkersKVStore } from "@hono-rate-limiter/cloudflare";
import {
  createDb,
  events,
  trackEventSchema,
  batchEventsSchema,
  type Database,
  type TrackEventInput,
} from "./db";

const STATS_CACHE_SECONDS = 900;

interface Env {
  DB: D1Database;
  RATE_LIMIT_KV: KVNamespace;
}

const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({
    origin: ["https://chronicle.atyb.me", "http://localhost:4321"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  })
);

app.post("/v1/track", zValidator("json", trackEventSchema), async (c) => {
  const event = c.req.valid("json");
  const db = createDb(c.env.DB);
  await insertEvent(db, event);
  return c.json({ success: true });
});

app.post("/v1/batch", zValidator("json", batchEventsSchema), async (c) => {
  const { events: eventList } = c.req.valid("json");
  const db = createDb(c.env.DB);
  await insertEvents(db, eventList);
  return c.json({ success: true, processed: eventList.length });
});

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.get(
  "/v1/stats",
  async (c, next) => {
    if (!c.env.RATE_LIMIT_KV) return next();

    try {
      return await rateLimiter<{ Bindings: Env }>({
        windowMs: 60 * 1000,
        limit: 60,
        standardHeaders: "draft-6",
        keyGenerator: (c) => c.req.header("cf-connecting-ip") ?? "anonymous",
        store: new WorkersKVStore({ namespace: c.env.RATE_LIMIT_KV, prefix: "rl_" }),
      })(c, next);
    } catch (error) {
      console.error("Failed to apply stats rate limit", error);
      return next();
    }
  },
  async (c) => {
    const rawDays = c.req.query("days");
    const parsedDays = rawDays ? Number.parseInt(rawDays, 10) : NaN;
    const days = Number.isFinite(parsedDays) && parsedDays > 0 ? Math.min(parsedDays, 365) : undefined;
    const cacheKey = days ? `cache:stats:days:${days}` : "cache:stats:all";

    if (c.env.RATE_LIMIT_KV) {
      try {
        const cached = await c.env.RATE_LIMIT_KV.get(cacheKey, "json");
        if (cached) {
          c.header("X-Cache", "HIT");
          c.header("Cache-Control", "public, max-age=300");
          return c.json(cached);
        }
      } catch (error) {
        console.error("Failed to read stats cache", error);
      }
    }

    const db = createDb(c.env.DB);
    const stats = await getStats(db, days);

    if (c.env.RATE_LIMIT_KV) {
      try {
        await c.env.RATE_LIMIT_KV.put(cacheKey, JSON.stringify(stats), {
          expirationTtl: STATS_CACHE_SECONDS,
        });
        c.header("X-Cache", "MISS");
      } catch (error) {
        console.error("Failed to write stats cache", error);
      }
    }

    c.header("Cache-Control", "public, max-age=300");
    return c.json(stats);
  }
);

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

export interface StatsData {
  unique_users: number;
  total_commits: number;
  total_files: number;
  total_backfills: number;
  ai_providers: Record<string, number>;
  ai_requests: number;
  activity_by_day: Array<{ date: string; backfills: number; commits: number }>;
  commands: Record<string, number>;
  date_ranges: Record<string, number>;
  model_categories: Record<string, number>;
}

async function getStats(db: Database, days?: number): Promise<StatsData> {
  const statsDateExpr = sql<string>`date(${events.receivedAt})`;
  const sinceDateExpr = days
    ? sql<string>`date(${new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()})`
    : null;

  const uniqueUsersQuery = db.select({ count: countDistinct(events.anonymousId) }).from(events);
  const backfillEventsQuery = db.select({ eventName: events.eventName, properties: events.properties }).from(events);
  const aiRequestsQuery = db.select({ properties: events.properties }).from(events);
  const activityQuery = db.select({ date: statsDateExpr, eventName: events.eventName, properties: events.properties }).from(events);
  const commandsQuery = db.select({ properties: events.properties }).from(events);
  const dateRangesQuery = db.select({ properties: events.properties }).from(events);
  const modelCategoriesQuery = db.select({ properties: events.properties }).from(events);

  const uniqueUsersPromise = sinceDateExpr
    ? uniqueUsersQuery.where(gte(statsDateExpr, sinceDateExpr)).then((rows) => rows[0]?.count ?? 0)
    : uniqueUsersQuery.then((rows) => rows[0]?.count ?? 0);

  const backfillStatsPromise = (async () => {
    const rows = sinceDateExpr
      ? await backfillEventsQuery.where(
          and(
            gte(statsDateExpr, sinceDateExpr),
            sql`${events.eventName} in ('backfill_executed', 'backfill_plan_generated')`,
          ),
        )
      : await backfillEventsQuery.where(sql`${events.eventName} in ('backfill_executed', 'backfill_plan_generated')`);

    const executedRows = rows.filter((row) => row.eventName === "backfill_executed");
    const planRows = rows.filter((row) => row.eventName === "backfill_plan_generated");
    const usePlanStats = executedRows.length === 0 && planRows.length > 0;
    const sourceRows = usePlanStats ? planRows : executedRows;

    let totalCommits = 0;
    let totalFiles = 0;
    let successCount = 0;

    for (const row of sourceRows) {
      try {
        const props = JSON.parse(row.properties);
        if (usePlanStats) {
          totalCommits += props.commits_suggested ?? 0;
          totalFiles += props.files_count ?? 0;
        } else {
          totalCommits += props.commits_created ?? 0;
          totalFiles += props.total_files ?? 0;
          if (props.success) successCount++;
        }
      } catch {}
    }

    return {
      total_backfills: sourceRows.length,
      total_commits: totalCommits,
      total_files: totalFiles,
      success_rate: sourceRows.length > 0 && !usePlanStats ? Math.round((successCount / sourceRows.length) * 100) : 0,
    };
  })();

  const aiProviderStatsPromise = (async () => {
    const rows = sinceDateExpr
      ? await aiRequestsQuery.where(and(gte(statsDateExpr, sinceDateExpr), sql`${events.eventName} = 'ai_request_made'`))
      : await aiRequestsQuery.where(sql`${events.eventName} = 'ai_request_made'`);

    const providers: Record<string, number> = {};
    let cacheHits = 0;

    for (const row of rows) {
      try {
        const props = JSON.parse(row.properties);
        const provider = props.provider ?? "unknown";
        providers[provider] = (providers[provider] ?? 0) + 1;
        if (props.cache_hit) cacheHits++;
      } catch {}
    }

    return {
      by_provider: providers,
      total_requests: rows.length,
      cache_hit_rate: rows.length > 0 ? Math.round((cacheHits / rows.length) * 100) : 0,
    };
  })();

  const activityByDayPromise = (async () => {
    const rows = sinceDateExpr
      ? await activityQuery.where(and(gte(statsDateExpr, sinceDateExpr), sql`${events.eventName} in ('backfill_executed', 'backfill_plan_generated')`))
      : await activityQuery.where(sql`${events.eventName} in ('backfill_executed', 'backfill_plan_generated')`);

    const byDay: Record<string, { backfills: number; commits: number }> = {};

    for (const row of rows) {
      const date = row.date;
      if (!byDay[date]) byDay[date] = { backfills: 0, commits: 0 };
      byDay[date].backfills++;

      try {
        const props = JSON.parse(row.properties);
        byDay[date].commits += row.eventName === "backfill_plan_generated" ? (props.commits_suggested ?? 0) : (props.commits_created ?? 0);
      } catch {}
    }

    return Object.entries(byDay)
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));
  })();

  const commandStatsPromise = (async () => {
    const rows = sinceDateExpr
      ? await commandsQuery.where(and(gte(statsDateExpr, sinceDateExpr), sql`${events.eventName} = 'command_invoked'`))
      : await commandsQuery.where(sql`${events.eventName} = 'command_invoked'`);

    const commands: Record<string, number> = {};
    for (const row of rows) {
      try {
        const props = JSON.parse(row.properties);
        const cmd = props.command ?? "unknown";
        if (cmd !== "help") commands[cmd] = (commands[cmd] ?? 0) + 1;
      } catch {}
    }
    return commands;
  })();

  const dateRangeStatsPromise = (async () => {
    const rows = sinceDateExpr
      ? await dateRangesQuery.where(and(gte(statsDateExpr, sinceDateExpr), sql`${events.eventName} = 'backfill_plan_generated'`))
      : await dateRangesQuery.where(sql`${events.eventName} = 'backfill_plan_generated'`);

    const ranges: Record<string, number> = {};
    for (const row of rows) {
      try {
        const props = JSON.parse(row.properties);
        const rangeDays = props.date_range_days;
        if (rangeDays !== undefined) {
          let rangeLabel: string;
          if (rangeDays <= 7) rangeLabel = "1-7 days";
          else if (rangeDays <= 14) rangeLabel = "8-14 days";
          else if (rangeDays <= 30) rangeLabel = "15-30 days";
          else if (rangeDays <= 60) rangeLabel = "31-60 days";
          else if (rangeDays <= 90) rangeLabel = "61-90 days";
          else rangeLabel = "90+ days";
          ranges[rangeLabel] = (ranges[rangeLabel] ?? 0) + 1;
        }
      } catch {}
    }
    return ranges;
  })();

  const modelCategoryStatsPromise = (async () => {
    const rows = sinceDateExpr
      ? await modelCategoriesQuery.where(and(gte(statsDateExpr, sinceDateExpr), sql`${events.eventName} = 'ai_request_made'`))
      : await modelCategoriesQuery.where(sql`${events.eventName} = 'ai_request_made'`);

    const categories: Record<string, number> = {};
    for (const row of rows) {
      try {
        const props = JSON.parse(row.properties);
        const category = props.model_category ?? "unknown";
        categories[category] = (categories[category] ?? 0) + 1;
      } catch {}
    }
    return categories;
  })();

  const [
    uniqueUsers,
    backfillStats,
    aiProviderStats,
    activityByDay,
    commandStats,
    dateRangeStats,
    modelCategoryStats,
  ] = await Promise.all([
    uniqueUsersPromise,
    backfillStatsPromise,
    aiProviderStatsPromise,
    activityByDayPromise,
    commandStatsPromise,
    dateRangeStatsPromise,
    modelCategoryStatsPromise,
  ]);

  return {
    unique_users: uniqueUsers,
    total_commits: backfillStats.total_commits,
    total_files: backfillStats.total_files,
    total_backfills: backfillStats.total_backfills,
    ai_providers: aiProviderStats.by_provider,
    ai_requests: aiProviderStats.total_requests,
    activity_by_day: activityByDay,
    commands: commandStats,
    date_ranges: dateRangeStats,
    model_categories: modelCategoryStats,
  };
}

export default app;
