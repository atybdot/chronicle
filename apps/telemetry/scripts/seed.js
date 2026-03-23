import { faker } from "@faker-js/faker";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);

const options = {
  database: getArgValue("--database", "chronicle-telemetry"),
  days: getNumberArg("--days", 45),
  eventsPerDay: getNumberArg("--events-per-day", 20),
  users: getNumberArg("--users", 120),
  seed: getNumberArg("--seed", 1337),
  remote: args.includes("--remote"),
  reset: args.includes("--reset"),
};

if (!options.remote && args.includes("--local") === false) {
  args.push("--local");
}

faker.seed(options.seed);

const commands = ["analyze", "backfill", "config", "status"];
const providers = ["openai", "anthropic", "gemini", "openrouter", "ollama", "cloudflare", "groq", "opencode-zen"];
const modelCategories = ["small", "medium", "large", "reasoning"];
const osTypes = ["darwin", "linux", "windows"];
const cliVersions = ["1.2.1", "1.2.0", "1.1.0", "1.0.0", "0.9.4"];

const users = Array.from({ length: options.users }, () => faker.string.uuid());
const sqlStatements = [];

if (options.reset) {
  sqlStatements.push("DELETE FROM daily_stats;", "DELETE FROM events;");
}

const startDate = startOfDay(new Date(Date.now() - (options.days - 1) * 24 * 60 * 60 * 1000));

for (let dayIndex = 0; dayIndex < options.days; dayIndex += 1) {
  const dayStart = new Date(startDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
  const minEvents = Math.max(4, Math.floor(options.eventsPerDay * 0.6));
  const maxEvents = Math.max(minEvents + 1, Math.floor(options.eventsPerDay * 1.4));
  const count = faker.number.int({ min: minEvents, max: maxEvents });

  for (let i = 0; i < count; i += 1) {
    const eventType = pickEventType();
    const createdAt = randomTimeOnDay(dayStart);
    const receivedAt = createdAt.toISOString();
    const timestamp = receivedAt;
    const anonymousId = faker.helpers.arrayElement(users);
    const cliVersion = faker.helpers.arrayElement(cliVersions);
    const osType = faker.helpers.arrayElement(osTypes);
    const isCi = faker.datatype.boolean({ probability: 0.12 });
    const properties = buildProperties(eventType);

    sqlStatements.push(
      buildInsert({
        eventName: eventType,
        anonymousId,
        timestamp,
        receivedAt,
        properties,
        cliVersion,
        osType,
        isCi,
      }),
    );
  }
}

const sqlFile = path.join(os.tmpdir(), `chronicle-seed-${Date.now()}.sql`);
writeFileSync(sqlFile, sqlStatements.join("\n"), "utf8");

const wranglerArgs = [
  "d1",
  "execute",
  options.database,
  options.remote ? "--remote" : "--local",
  "--file",
  sqlFile,
];

const result = spawnSync("wrangler", wranglerArgs, { stdio: "inherit" });

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`Seeded ${sqlStatements.length - (options.reset ? 2 : 0)} events into ${options.database}.`);

function getArgValue(key, fallback) {
  const index = args.findIndex((value) => value === key);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  const inline = args.find((value) => value.startsWith(`${key}=`));
  if (inline) return inline.split("=")[1];
  return fallback;
}

function getNumberArg(key, fallback) {
  const raw = getArgValue(key, "");
  if (raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function randomTimeOnDay(dayStart) {
  const offsetSeconds = faker.number.int({ min: 0, max: 24 * 60 * 60 - 1 });
  return new Date(dayStart.getTime() + offsetSeconds * 1000);
}

function pickEventType() {
  const roll = faker.number.float({ min: 0, max: 1 });
  if (roll < 0.35) return "backfill_plan_generated";
  if (roll < 0.6) return "backfill_executed";
  if (roll < 0.85) return "ai_request_made";
  return "command_invoked";
}

function buildProperties(eventName) {
  if (eventName === "backfill_plan_generated") {
    return {
      commits_suggested: faker.number.int({ min: 1, max: 6 }),
      files_count: faker.number.int({ min: 5, max: 80 }),
      date_range_days: faker.number.int({ min: 3, max: 120 }),
    };
  }

  if (eventName === "backfill_executed") {
    return {
      commits_created: faker.number.int({ min: 1, max: 6 }),
      total_files: faker.number.int({ min: 3, max: 90 }),
      success: faker.datatype.boolean({ probability: 0.8 }),
    };
  }

  if (eventName === "ai_request_made") {
    return {
      provider: faker.helpers.arrayElement(providers),
      cache_hit: faker.datatype.boolean({ probability: 0.25 }),
      model_category: faker.helpers.arrayElement(modelCategories),
    };
  }

  return {
    command: faker.helpers.arrayElement(commands),
  };
}

function buildInsert({
  eventName,
  anonymousId,
  timestamp,
  receivedAt,
  properties,
  cliVersion,
  osType,
  isCi,
}) {
  const propsJson = JSON.stringify(properties);
  return (
    "INSERT INTO events (event_name, anonymous_id, timestamp, received_at, properties, cli_version, os_type, is_ci) VALUES (" +
    [
      sqlString(eventName),
      sqlString(anonymousId),
      sqlString(timestamp),
      sqlString(receivedAt),
      sqlString(propsJson),
      sqlString(cliVersion),
      sqlString(osType),
      isCi ? "1" : "0",
    ].join(", ") +
    ");"
  );
}

function sqlString(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}
