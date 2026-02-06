import { z } from "zod";
import { randomUUID } from "crypto";
import { homedir, platform } from "os";
import { join } from "path";

// ============================================================================
// Configuration
// ============================================================================

// Chronicle telemetry API endpoint (Cloudflare Worker)
const TELEMETRY_ENDPOINT = process.env.TELEMETRY_ENDPOINT || "https://chronicle-telemetry.atyb.workers.dev";
const TELEMETRY_DIR = join(homedir(), ".config", "chronicle");
const TELEMETRY_FILE = join(TELEMETRY_DIR, "telemetry.json");

// Environment variable to disable telemetry
const TELEMETRY_ENV_VAR = "CHRONICLE_TELEMETRY";

const CLI_VERSION = "0.1.0";

// ============================================================================
// Telemetry State Schema
// ============================================================================

const TelemetryStateSchema = z.object({
  enabled: z.boolean(),
  anonymousId: z.string(),
  optedOut: z.boolean(), // true if user explicitly opted out
  noticeShown: z.boolean().optional(), // true if telemetry notice has been shown
  createdAt: z.string().datetime(),
  lastEventAt: z.string().datetime().optional(),
});

type TelemetryState = z.infer<typeof TelemetryStateSchema>;

// ============================================================================
// Event Schemas (what we collect)
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

// ============================================================================
// Telemetry Client
// ============================================================================

class TelemetryClient {
  private state: TelemetryState | null = null;
  private initialized = false;
  private eventQueue: TelemetryEvent[] = [];
  private flushTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Check if telemetry is enabled based on env var and user preference
   * Default: ENABLED (opt-out via CHRONICLE_TELEMETRY=false)
   */
  isEnabledByDefault(): boolean {
    const envValue = process.env[TELEMETRY_ENV_VAR];

    if (envValue !== undefined) {
      const lower = envValue.toLowerCase();
      return lower !== "false" && lower !== "0";
    }

    return true; // Default: enabled
  }

  /**
   * Initialize the telemetry client
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      this.state = await this.loadState();
      this.initialized = true;
    } catch {
      this.initialized = true;
    }
  }

  /**
   * Check if telemetry is currently enabled
   */
  async isEnabled(): Promise<boolean> {
    if (!this.initialized) await this.init();

    if (!this.state) return this.isEnabledByDefault();

    if (this.state.optedOut) return false;

    return this.isEnabledByDefault();
  }

  /**
   * Opt-out of telemetry (user explicitly disables)
   */
  async optOut(): Promise<void> {
    if (!this.initialized) await this.init();

    if (this.state) {
      this.state.optedOut = true;
      await this.saveState();
    }
  }

  /**
   * Opt-in to telemetry (re-enable after opting out)
   */
  async optIn(): Promise<void> {
    if (!this.initialized) await this.init();

    if (this.state) {
      this.state.optedOut = false;
      await this.saveState();
    }
  }

  /**
   * Check if user has explicitly opted out
   */
  async hasOptedOut(): Promise<boolean> {
    if (!this.initialized) await this.init();
    return this.state?.optedOut ?? false;
  }

  /**
   * Check if telemetry notice has been shown to the user
   */
  async hasNoticeBeenShown(): Promise<boolean> {
    if (!this.initialized) await this.init();
    return this.state?.noticeShown ?? false;
  }

  /**
   * Mark the telemetry notice as shown
   */
  async markNoticeShown(): Promise<void> {
    if (!this.initialized) await this.init();

    if (this.state) {
      this.state.noticeShown = true;
      await this.saveState();
    }
  }

  /**
   * Track an event (non-blocking)
   */
  track(eventData: TelemetryEvent): void {
    this.trackAsync(eventData).catch(() => {});
  }

  /**
   * Track an event (async version)
   */
  private async trackAsync(eventData: TelemetryEvent): Promise<void> {
    if (!this.initialized) await this.init();

    const enabled = await this.isEnabled();

    if (!enabled) return;

    this.eventQueue.push(eventData);
    this.scheduleFlush();
  }

  /**
   * Schedule a flush with debouncing
   */
  private scheduleFlush(): void {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
    }

    const delay = this.eventQueue.length >= 10 ? 0 : 1000;

    this.flushTimeout = setTimeout(() => {
      this.flush().catch(() => {});
    }, delay);
  }

  /**
   * Flush pending events to the server
   */
  async flush(): Promise<void> {
    if (this.eventQueue.length === 0 || !this.state) return;

    const eventsToSend = [...this.eventQueue];
    this.eventQueue = [];

    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }

    try {
      const context = this.getContext();

      const payload = {
        events: eventsToSend.map((e) => ({
          event: e.event,
          anonymousId: this.state!.anonymousId,
          timestamp: new Date().toISOString(),
          properties: e.properties,
          context,
        })),
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      await fetch(`${TELEMETRY_ENDPOINT}/v1/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      this.state.lastEventAt = new Date().toISOString();
      await this.saveState();
    } catch {
      this.eventQueue.unshift(...eventsToSend);
    }
  }

  /**
   * Shutdown the client gracefully
   */
  async shutdown(): Promise<void> {
    await this.flush();
  }

  /**
   * Get the anonymous user ID
   */
  async getAnonymousId(): Promise<string | null> {
    if (!this.initialized) await this.init();
    return this.state?.anonymousId ?? null;
  }

  /**
   * Get context properties for events
   */
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

  /**
   * Load telemetry state from disk
   */
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

  /**
   * Save telemetry state to disk
   */
  private async saveState(): Promise<void> {
    if (!this.state) return;

    try {
      await Bun.write(join(TELEMETRY_DIR, ".keep"), "");
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
