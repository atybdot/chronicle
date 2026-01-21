/**
 * Database utilities for Chronicle Telemetry
 *
 * Uses Drizzle ORM with Cloudflare D1 binding.
 * Access D1 via c.env.DB in Hono handlers.
 */

import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema";

export type Database = DrizzleD1Database<typeof schema>;

/**
 * Create a Drizzle database instance from D1 binding
 *
 * @example
 * ```typescript
 * app.get("/users", async (c) => {
 *   const db = createDb(c.env.DB);
 *   const users = await db.select().from(schema.events);
 *   return c.json(users);
 * });
 * ```
 */
export function createDb(d1: D1Database): Database {
  return drizzle(d1, { schema });
}

// Re-export everything from schema for convenience
export * from "./schema";
