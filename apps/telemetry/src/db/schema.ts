import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    eventName: text("event_name").notNull(),
    anonymousId: text("anonymous_id").notNull(),
    timestamp: text("timestamp")
      .notNull()
      .default(sql`(datetime('now'))`),
    receivedAt: text("received_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    properties: text("properties").notNull().default("{}"),
    cliVersion: text("cli_version"),
    osType: text("os_type"),
    isCi: integer("is_ci", { mode: "boolean" }).default(false),
  },
  (table) => [
    index("idx_events_timestamp").on(table.timestamp),
    index("idx_events_name").on(table.eventName),
    index("idx_events_version").on(table.cliVersion),
    index("idx_events_anonymous_id").on(table.anonymousId),
    index("idx_events_name_timestamp").on(table.eventName, table.timestamp),
  ],
);

export const dailyStats = sqliteTable(
  "daily_stats",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    date: text("date").notNull(),
    eventName: text("event_name").notNull(),
    eventCount: integer("event_count").default(0),
    uniqueUsers: integer("unique_users").default(0),
    metrics: text("metrics").default("{}"),
  },
  (table) => [
    uniqueIndex("idx_daily_stats_unique").on(table.date, table.eventName),
    index("idx_daily_stats_date").on(table.date),
  ],
);

export const insertEventSchema = createInsertSchema(events);
export const selectEventSchema = createSelectSchema(events);
export const insertDailyStatSchema = createInsertSchema(dailyStats);
export const selectDailyStatSchema = createSelectSchema(dailyStats);

export const trackEventSchema = z.object({
  event: z.string().min(1).max(100),
  anonymousId: z.string().min(1).max(100),
  timestamp: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  context: z
    .object({
      cli_version: z.string().optional(),
      os_type: z.string().optional(),
      is_ci: z.boolean().optional(),
    })
    .optional(),
});

export const batchEventsSchema = z.object({
  events: z.array(trackEventSchema).max(100),
});

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type DailyStat = typeof dailyStats.$inferSelect;
export type NewDailyStat = typeof dailyStats.$inferInsert;
export type TrackEventInput = z.infer<typeof trackEventSchema>;
export type BatchEventsInput = z.infer<typeof batchEventsSchema>;
