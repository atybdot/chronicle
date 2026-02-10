/**
 * Seed script for telemetry data
 *
 * Generates realistic CLI telemetry data matching the actual chronicle CLI events:
 * - backfill_executed: commits created, files processed
 * - ai_request_made: provider usage, cache hits, latency
 * - command_invoked: command usage patterns
 * - setup_completed: provider adoption
 * - error_occurred: error tracking
 *
 * Usage:
 *   bun run db:seed         # seed local D1 database
 *   bun run db:seed:remote  # seed remote D1 database
 */

import { faker } from "@faker-js/faker";

// ============================================================================
// Event Types (matching CLI telemetry schema)
// ============================================================================

type EventType =
  | "backfill_executed"
  | "backfill_plan_generated"
  | "ai_request_made"
  | "command_invoked"
  | "setup_completed"
  | "config_changed"
  | "error_occurred";

// Weighted event distribution (realistic usage patterns)
const EVENT_WEIGHTS: { type: EventType; weight: number }[] = [
  { type: "command_invoked", weight: 35 }, // Most common - every command run
  { type: "ai_request_made", weight: 25 }, // AI calls during analysis
  { type: "backfill_plan_generated", weight: 15 }, // Plan generation
  { type: "backfill_executed", weight: 12 }, // Actual backfills (less than plans - some are dry runs)
  { type: "setup_completed", weight: 5 }, // First-time setup
  { type: "config_changed", weight: 5 }, // Config tweaks
  { type: "error_occurred", weight: 3 }, // Errors (low rate = healthy CLI)
];

// AI providers with realistic market share
const AI_PROVIDERS = [
  { value: "anthropic", weight: 40 },
  { value: "openai", weight: 35 },
  { value: "gemini", weight: 15 },
  { value: "ollama", weight: 7 },
  { value: "openrouter", weight: 3 },
];

const MODEL_CATEGORIES = ["small", "medium", "large"] as const;

const COMMANDS = ["backfill", "analyze", "setup", "config", "status", "help"];

const ERROR_TYPES = [
  "api_key_invalid",
  "rate_limit_exceeded",
  "git_not_found",
  "no_changes_detected",
  "network_error",
  "parse_error",
];

// ============================================================================
// Property Generators
// ============================================================================

function generateBackfillExecutedProps() {
  const commitsCreated = faker.number.int({ min: 1, max: 25 });
  const commitsSkipped = faker.number.int({ min: 0, max: 3 });
  return {
    commits_created: commitsCreated,
    commits_skipped: commitsSkipped,
    total_files: faker.number.int({ min: commitsCreated, max: commitsCreated * 8 }),
    duration_ms: faker.number.int({ min: 2000, max: 45000 }),
    success: faker.datatype.boolean({ probability: 0.95 }),
  };
}

function generateBackfillPlanProps() {
  return {
    commits_suggested: faker.number.int({ min: 1, max: 30 }),
    files_count: faker.number.int({ min: 1, max: 50 }),
    date_range_days: faker.number.int({ min: 1, max: 90 }),
    dry_run: faker.datatype.boolean({ probability: 0.4 }),
    output_format: faker.helpers.arrayElement(["visual", "json", "minimal"]),
  };
}

function generateAiRequestProps() {
  const provider = faker.helpers.weightedArrayElement(
    AI_PROVIDERS.map((p) => ({ value: p.value, weight: p.weight })),
  );
  return {
    provider,
    model_category: faker.helpers.arrayElement(MODEL_CATEGORIES),
    request_type: faker.helpers.arrayElement(["analyze", "commit_messages", "date_parse"]),
    latency_ms: faker.number.int({ min: 200, max: 8000 }),
    cache_hit: faker.datatype.boolean({ probability: 0.25 }),
    success: faker.datatype.boolean({ probability: 0.92 }),
  };
}

function generateCommandInvokedProps() {
  const command = faker.helpers.weightedArrayElement([
    { value: "backfill", weight: 45 },
    { value: "analyze", weight: 25 },
    { value: "setup", weight: 10 },
    { value: "config", weight: 10 },
    { value: "status", weight: 5 },
    { value: "help", weight: 5 },
  ]);
  return {
    command,
    duration_ms: faker.number.int({ min: 50, max: 30000 }),
    success: faker.datatype.boolean({ probability: 0.94 }),
    interactive: faker.datatype.boolean({ probability: 0.6 }),
  };
}

function generateSetupCompletedProps() {
  return {
    provider: faker.helpers.weightedArrayElement(
      AI_PROVIDERS.map((p) => ({ value: p.value, weight: p.weight })),
    ),
    model_category: faker.helpers.arrayElement(MODEL_CATEGORIES),
    api_key_source: faker.helpers.weightedArrayElement([
      { value: "entered", weight: 60 },
      { value: "environment", weight: 35 },
      { value: "skipped", weight: 5 },
    ]),
  };
}

function generateConfigChangedProps() {
  return {
    key: faker.helpers.arrayElement([
      "ai.provider",
      "ai.model",
      "output.format",
      "git.signCommits",
      "telemetry.enabled",
    ]),
  };
}

function generateErrorProps() {
  return {
    error_type: faker.helpers.arrayElement(ERROR_TYPES),
    command: faker.helpers.arrayElement(COMMANDS),
  };
}

function generatePropertiesForEvent(eventType: EventType): Record<string, unknown> {
  switch (eventType) {
    case "backfill_executed":
      return generateBackfillExecutedProps();
    case "backfill_plan_generated":
      return generateBackfillPlanProps();
    case "ai_request_made":
      return generateAiRequestProps();
    case "command_invoked":
      return generateCommandInvokedProps();
    case "setup_completed":
      return generateSetupCompletedProps();
    case "config_changed":
      return generateConfigChangedProps();
    case "error_occurred":
      return generateErrorProps();
  }
}

// ============================================================================
// Event Generation
// ============================================================================

function randomDate(daysAgo: number): string {
  const now = new Date();
  const past = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  const randomTime = past.getTime() + Math.random() * (now.getTime() - past.getTime());
  return new Date(randomTime).toISOString();
}

function generateEvents(count: number, daysAgo: number = 30) {
  const events = [];
  const uniqueUsers = Math.ceil(count / 8); // ~8 events per user average
  const userIds = Array.from({ length: uniqueUsers }, () => faker.string.uuid());

  // Create weighted array for event selection
  const weightedEvents = EVENT_WEIGHTS.map((e) => ({ value: e.type, weight: e.weight }));

  for (let i = 0; i < count; i++) {
    const eventName = faker.helpers.weightedArrayElement(weightedEvents);
    const anonymousId = faker.helpers.arrayElement(userIds);
    const timestamp = randomDate(daysAgo);

    // Version distribution: newer versions more common
    const cliVersion = faker.helpers.weightedArrayElement([
      { value: "0.1.0", weight: 5 },
      { value: "0.2.0", weight: 8 },
      { value: "0.3.0", weight: 10 },
      { value: "0.4.0", weight: 12 },
      { value: "0.5.0", weight: 15 },
      { value: "1.0.0", weight: 20 },
      { value: "1.0.1", weight: 15 },
      { value: "1.1.0", weight: 15 },
    ]);

    const osType = faker.helpers.weightedArrayElement([
      { value: "darwin", weight: 50 }, // macOS popular with devs
      { value: "linux", weight: 35 },
      { value: "windows", weight: 15 },
    ]);

    const isCi = faker.datatype.boolean({ probability: 0.12 }); // 12% CI usage

    const properties = generatePropertiesForEvent(eventName);

    events.push({
      event_name: eventName,
      anonymous_id: anonymousId,
      timestamp,
      received_at: timestamp,
      properties: JSON.stringify(properties),
      cli_version: cliVersion,
      os_type: osType,
      is_ci: isCi ? 1 : 0,
    });
  }

  // Sort by timestamp for realistic insertion order
  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return events;
}

// ============================================================================
// SQL Generation
// ============================================================================

function generateSQL(events: ReturnType<typeof generateEvents>): string {
  const lines: string[] = [];

  lines.push("-- Chronicle CLI Telemetry Seed Data");
  lines.push(`-- Generated: ${new Date().toISOString()}`);
  lines.push(`-- Events: ${events.length}`);
  lines.push("");
  lines.push("DELETE FROM events;");
  lines.push("");

  // Insert in batches of 50 for better readability
  const batchSize = 50;
  for (let i = 0; i < events.length; i += batchSize) {
    const batch = events.slice(i, i + batchSize);
    const values = batch
      .map(
        (e) =>
          `('${e.event_name}', '${e.anonymous_id}', '${e.timestamp}', '${e.received_at}', '${e.properties.replace(/'/g, "''")}', '${e.cli_version}', '${e.os_type}', ${e.is_ci})`,
      )
      .join(",\n  ");

    lines.push(`INSERT INTO events (event_name, anonymous_id, timestamp, received_at, properties, cli_version, os_type, is_ci) VALUES
  ${values};`);
    lines.push("");
  }

  return lines.join("\n");
}

// ============================================================================
// Main
// ============================================================================

const eventCount = parseInt(process.argv[2] || "800", 10);
const daysAgo = parseInt(process.argv[3] || "30", 10);

console.error(`Generating ${eventCount} chronicle CLI events over the last ${daysAgo} days...`);

const events = generateEvents(eventCount, daysAgo);

// Calculate stats for verification
const stats = {
  total: events.length,
  uniqueUsers: new Set(events.map((e) => e.anonymous_id)).size,
  byType: events.reduce(
    (acc, e) => {
      acc[e.event_name] = (acc[e.event_name] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  ),
};

console.error(`Generated ${stats.total} events from ${stats.uniqueUsers} unique users`);
console.error("Event distribution:", stats.byType);

const sql = generateSQL(events);
process.stdout.write(sql);
