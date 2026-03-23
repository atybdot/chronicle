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
    const rawDays = c.req.query("days") || "7";
    const parsedDays = Number.parseInt(rawDays, 10);
    const days = Number.isFinite(parsedDays) && parsedDays > 0 ? Math.min(parsedDays, 365) : 7;
    const cacheKey = `cache:stats:days:${days}`;

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

async function getStats(db: Database, days: number): Promise<StatsData> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString();

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
