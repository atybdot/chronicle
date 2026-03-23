import { z } from "zod";
import { randomUUID } from "crypto";
import { homedir, platform } from "os";
import { join } from "path";
import { Result } from "better-result";
import { TelemetryPersistError, TelemetryFlushError } from "./errors";
import pkgInfo from '../../package.json'
// ============================================================================
// Configuration
// ============================================================================

const TELEMETRY_ENDPOINT = process.env.TELEMETRY_ENDPOINT || "https://chronicle-telemetry.atybdot.workers.dev";
const TELEMETRY_DIR = join(homedir(), ".config", "chronicle");
const TELEMETRY_FILE = join(TELEMETRY_DIR, "telemetry.json");
const EVENTS_FILE = join(TELEMETRY_DIR, "telemetry-events.jsonl");
const TELEMETRY_ENV_VAR = "CHRONICLE_TELEMETRY";
const CLI_VERSION = pkgInfo.version
const MAX_PENDING_EVENTS = 1000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// ============================================================================
// Telemetry State Schema
// ============================================================================

const TelemetryStateSchema = z.object({
  enabled: z.boolean(),
  anonymousId: z.string(),
  optedOut: z.boolean(),
  noticeShown: z.boolean().optional(),
  createdAt: z.string().datetime(),
  lastEventAt: z.string().datetime().optional(),
});

type TelemetryState = z.infer<typeof TelemetryStateSchema>;

// ============================================================================
// Event Schemas
// ============================================================================

const CommandInvokedSchema = z.object({
  command: z.string(),
  subcommand: z.string().optional(),
  duration_ms: z.number().optional(),
  success: z.boolean(),
  error_type: z.string().optional(),
  interactive: z.boolean().optional(),
});

const BackfillPlanGeneratedSchema = z.object({
  commits_suggested: z.number(),
  files_count: z.number(),
  date_range_days: z.number(),
  dry_run: z.boolean(),
  output_format: z.enum(["visual", "json", "minimal"]),
});

const BackfillExecutedSchema = z.object({
  commits_created: z.number(),
  commits_skipped: z.number(),
  total_files: z.number(),
  duration_ms: z.number(),
  success: z.boolean(),
});

const AIRequestMadeSchema = z.object({
  provider: z.string(),
  model_category: z.enum(["small", "medium", "large", "unknown"]),
  request_type: z.enum(["analyze", "commit_messages", "date_parse"]),
  latency_ms: z.number(),
  cache_hit: z.boolean(),
  success: z.boolean(),
  error_type: z.string().optional(),
});

const ConfigChangedSchema = z.object({
  key: z.string(),
  provider: z.string().optional(),
});

const SetupCompletedSchema = z.object({
  provider: z.string(),
  model_category: z.enum(["small", "medium", "large", "unknown"]),
  api_key_source: z.enum(["entered", "environment", "skipped"]),
});

const ErrorOccurredSchema = z.object({
  error_type: z.string(),
  command: z.string().optional(),
  context: z.string().optional(),
});

export type TelemetryEvent =
  | { event: "command_invoked"; properties: z.infer<typeof CommandInvokedSchema> }
  | { event: "backfill_plan_generated"; properties: z.infer<typeof BackfillPlanGeneratedSchema> }
  | { event: "backfill_executed"; properties: z.infer<typeof BackfillExecutedSchema> }
  | { event: "ai_request_made"; properties: z.infer<typeof AIRequestMadeSchema> }
  | { event: "config_changed"; properties: z.infer<typeof ConfigChangedSchema> }
  | { event: "setup_completed"; properties: z.infer<typeof SetupCompletedSchema> }
  | { event: "error_occurred"; properties: z.infer<typeof ErrorOccurredSchema> };

interface PersistedEvent {
  id: string;
  event: TelemetryEvent;
  timestamp: string;
  retryCount: number;
}

// ============================================================================
// Telemetry Client
// ============================================================================

class TelemetryClient {
  private state: TelemetryState | null = null;
  private initialized = false;
  private flushTimeout: ReturnType<typeof setTimeout> | null = null;

  isEnabledByDefault(): boolean {
    const envValue = process.env[TELEMETRY_ENV_VAR];
    if (envValue !== undefined) {
      const lower = envValue.toLowerCase();
      return lower !== "false" && lower !== "0";
    }
    return true;
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      this.state = await this.loadState();
      await this.flushPendingEvents();
      this.initialized = true;
      this.flushPendingEvents().catch(() => {});
    } catch {
      this.initialized = true;
    }
  }

  async isEnabled(): Promise<boolean> {
    if (!this.initialized) await this.init();
    if (!this.state) return this.isEnabledByDefault();
    if (this.state.optedOut) return false;
    return this.isEnabledByDefault();
  }

  async optOut(): Promise<void> {
    if (!this.initialized) await this.init();
    if (this.state) {
      this.state.optedOut = true;
      await this.saveState();
    }
  }

  async optIn(): Promise<void> {
    if (!this.initialized) await this.init();
    if (this.state) {
      this.state.optedOut = false;
      await this.saveState();
    }
  }

  async hasOptedOut(): Promise<boolean> {
    if (!this.initialized) await this.init();
    return this.state?.optedOut ?? false;
  }

  async hasNoticeBeenShown(): Promise<boolean> {
    if (!this.initialized) await this.init();
    return this.state?.noticeShown ?? false;
  }

  async markNoticeShown(): Promise<void> {
    if (!this.initialized) await this.init();
    if (this.state) {
      this.state.noticeShown = true;
      await this.saveState();
    }
  }

  track(eventData: TelemetryEvent): void {
    this.trackAsync(eventData).catch(() => {});
  }

  private async trackAsync(eventData: TelemetryEvent): Promise<void> {
    if (!this.initialized) await this.init();

    const enabled = await this.isEnabled();
    if (!enabled) return;

    const result = await this.persistEvent(eventData);
    if (result.isErr()) return;

    this.scheduleFlush();
  }

  private async persistEvent(event: TelemetryEvent): Promise<Result<void, TelemetryPersistError>> {
    return Result.tryPromise({
      try: async () => {
        await this.ensureDir();

        const persistedEvent: PersistedEvent = {
          id: randomUUID(),
          event,
          timestamp: new Date().toISOString(),
          retryCount: 0,
        };

        const existingEvents = await this.loadPendingEvents();
        existingEvents.push(persistedEvent);

        const content = existingEvents.map((e) => JSON.stringify(e)).join("\n") + "\n";
        await Bun.write(EVENTS_FILE, content);
      },
      catch: (e) =>
        new TelemetryPersistError({
          message: `Failed to persist telemetry event: ${e instanceof Error ? e.message : String(e)}`,
          cause: e,
        }),
    });
  }

  private async loadPendingEvents(): Promise<PersistedEvent[]> {
    try {
      const file = Bun.file(EVENTS_FILE);
      if (!(await file.exists())) return [];

      const content = await file.text();
      const lines = content.trim().split("\n").filter(Boolean);

      const events: PersistedEvent[] = [];
      for (const line of lines) {
        try {
          events.push(JSON.parse(line) as PersistedEvent);
        } catch {
          // Skip malformed lines
        }
      }

      return events;
    } catch {
      return [];
    }
  }

  private async clearPendingEvents(): Promise<void> {
    try {
      const file = Bun.file(EVENTS_FILE);
      if (await file.exists()) {
        await Bun.write(EVENTS_FILE, "");
      }
    } catch {
      // Silently fail
    }
  }

  private async writePendingEvents(events: PersistedEvent[]): Promise<void> {
    try {
      await this.ensureDir();
      const content = events.map((e) => JSON.stringify(e)).join("\n") + (events.length > 0 ? "\n" : "");
      await Bun.write(EVENTS_FILE, content);
    } catch {
      // Silently fail
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
    }

    this.flushTimeout = setTimeout(() => {
      this.flush().catch(() => {});
    }, 1000);
  }

  async flush(): Promise<Result<void, TelemetryFlushError>> {
    if (!this.state) return Result.ok(undefined);

    const events = await this.loadPendingEvents();
    if (events.length === 0) return Result.ok(undefined);

    // Filter out events that have exceeded max retries
    const validEvents = events.filter((e) => e.retryCount < MAX_RETRIES);
    if (validEvents.length === 0) {
      await this.clearPendingEvents();
      return Result.ok(undefined);
    }

    // Limit batch size
    const batch = validEvents.slice(0, MAX_PENDING_EVENTS);

    const result = await this.sendBatch(batch);

    if (result.isErr()) {
      // Increment retry count for failed events
      const updatedEvents = validEvents.map((e) => ({
        ...e,
        retryCount: e.retryCount + 1,
      }));
      await this.writePendingEvents(updatedEvents);

      return Result.err(
        new TelemetryFlushError({
          message: result.error.message,
          eventCount: batch.length,
          cause: result.error.cause,
        }),
      );
    }

    // Remove sent events, keep any that weren't in this batch
    const remainingEvents = validEvents.slice(batch.length);
    await this.writePendingEvents(
      remainingEvents.map((e) => ({
        ...e,
        retryCount: e.retryCount + 1,
      })),
    );

    this.state.lastEventAt = new Date().toISOString();
    await this.saveState();

    return Result.ok(undefined);
  }

  private async sendBatch(
    events: PersistedEvent[],
  ): Promise<Result<Response, TelemetryFlushError>> {
    return Result.tryPromise({
      try: async () => {
        const context = this.getContext();

        const payload = {
          events: events.map((e) => ({
            event: e.event.event,
            anonymousId: this.state!.anonymousId,
            timestamp: e.timestamp,
            properties: e.event.properties,
            context,
          })),
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(`${TELEMETRY_ENDPOINT}/v1/batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Server returned ${response.status}`);
        }

        return response;
      },
      catch: (e) =>
        new TelemetryFlushError({
          message: `Failed to send telemetry batch: ${e instanceof Error ? e.message : String(e)}`,
          eventCount: events.length,
          cause: e,
        }),
    });
  }

  private async flushPendingEvents(): Promise<void> {
    const events = await this.loadPendingEvents();
    if (events.length === 0) return;

    // Retry with exponential backoff
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const result = await this.flush();
      if (result.isOk()) return;

      if (attempt < MAX_RETRIES - 1) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * Math.pow(2, attempt)));
      }
    }
  }

  async shutdown(): Promise<void> {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }
    await this.flush();
  }

  async getAnonymousId(): Promise<string | null> {
    if (!this.initialized) await this.init();
    return this.state?.anonymousId ?? null;
  }

  private getContext(): { cli_version: string; os_type: string; is_ci: boolean } {
    const os = platform();
    const osType =
      os === "darwin" ? "darwin" : os === "linux" ? "linux" : os === "win32" ? "windows" : "unknown";

    return {
      cli_version: CLI_VERSION,
      os_type: osType,
      is_ci: isCI(),
    };
  }

  private async ensureDir(): Promise<void> {
    try {
      await Bun.write(join(TELEMETRY_DIR, ".keep"), "");
    } catch {
      // Directory might already exist
    }
  }

  private async loadState(): Promise<TelemetryState> {
    try {
      const file = Bun.file(TELEMETRY_FILE);
      if (await file.exists()) {
        const content = await file.json();
        const parsed = TelemetryStateSchema.safeParse(content);
        if (parsed.success) {
          return parsed.data;
        }
      }
    } catch {
      // File doesn't exist or is invalid
    }

    return {
      enabled: true,
      anonymousId: randomUUID(),
      optedOut: false,
      createdAt: new Date().toISOString(),
    };
  }

  private async saveState(): Promise<void> {
    if (!this.state) return;

    try {
      await this.ensureDir();
      await Bun.write(TELEMETRY_FILE, JSON.stringify(this.state, null, 2));
    } catch {
      // Silently fail
    }
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function isCI(): boolean {
  return !!(
    process.env.CI ||
    process.env.CONTINUOUS_INTEGRATION ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.CIRCLECI ||
    process.env.TRAVIS ||
    process.env.JENKINS_URL ||
    process.env.BUILDKITE
  );
}

export function categorizeModel(modelId: string): "small" | "medium" | "large" | "unknown" {
  const lower = modelId.toLowerCase();

  if (
    lower.includes("mini") ||
    lower.includes("small") ||
    lower.includes("tiny") ||
    lower.includes("nano") ||
    lower.includes("haiku") ||
    lower.includes("flash") ||
    lower.includes("gpt-3.5") ||
    lower.includes("gpt-4o-mini")
  ) {
    return "small";
  }

  if (
    lower.includes("opus") ||
    lower.includes("ultra") ||
    lower.includes("pro") ||
    lower.includes("gpt-4o") ||
    lower.includes("gpt-4-turbo") ||
    lower.includes("claude-3-5-sonnet") ||
    lower.includes("gemini-1.5-pro") ||
    lower.includes("70b") ||
    lower.includes("405b")
  ) {
    return "large";
  }

  if (
    lower.includes("sonnet") ||
    lower.includes("gpt-4") ||
    lower.includes("gemini") ||
    lower.includes("llama") ||
    lower.includes("mistral") ||
    lower.includes("claude")
  ) {
    return "medium";
  }

  return "unknown";
}

export function createTimer(): () => number {
  const start = performance.now();
  return () => Math.round(performance.now() - start);
}

export const telemetry = new TelemetryClient();

process.on("beforeExit", async () => {
  try {
    await telemetry.shutdown();
  } catch {
    // Silently fail during shutdown
  }
});

export type { TelemetryState };
export { TELEMETRY_ENV_VAR };
