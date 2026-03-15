import { TaggedError } from "better-result";

/**
 * Error when not in a git repository
 */
export class NotGitRepoError extends TaggedError("NotGitRepoError")<{
  path: string;
  message: string;
}>() {
  constructor(args: { path: string }) {
    super({ ...args, message: `Not a git repository: ${args.path}` });
  }
}

/**
 * Error when git command fails
 */
export class GitCommandError extends TaggedError("GitCommandError")<{
  command: string;
  message: string;
}>() {}

/**
 * Error when no API key is configured
 */
export class NoApiKeyError extends TaggedError("NoApiKeyError")<{
  provider: string;
  message: string;
}>() {
  constructor(args: { provider: string; message?: string }) {
    super({
      provider: args.provider,
      message: args.message ?? `No API key configured for ${args.provider}. Run 'chronicle config init' to set up or set CHRONICLE_AI_KEY environment variable.`,
    });
  }
}

/**
 * Error when AI API call fails
 */
export class AIApiError extends TaggedError("AIApiError")<{
  provider: string;
  message: string;
  cause?: unknown;
}>() {}

/**
 * Error when config file is invalid
 */
export class ConfigError extends TaggedError("ConfigError")<{
  path: string;
  message: string;
}>() {}

/**
 * Error when no changes are found to analyze
 */
export class NoChangesError extends TaggedError("NoChangesError")<{
  message: string;
}>() {
  constructor() {
    super({ message: "No uncommitted changes found. Make some changes first!" });
  }
}

/**
 * Error when date range is invalid
 */
export class InvalidDateRangeError extends TaggedError("InvalidDateRangeError")<{
  input: string;
  message: string;
}>() {
  constructor(args: { input: string }) {
    super({ ...args, message: `Could not parse date range: "${args.input}"` });
  }
}

/**
 * Error when user cancels operation
 */
export class UserCancelledError extends TaggedError("UserCancelledError")<{
  message: string;
}>() {
  constructor() {
    super({ message: "Operation cancelled by user" });
  }
}

/**
 * Error when telemetry event persistence fails
 */
export class TelemetryPersistError extends TaggedError("TelemetryPersistError")<{
  message: string;
  cause?: unknown;
}>() {}

/**
 * Error when telemetry flush fails
 */
export class TelemetryFlushError extends TaggedError("TelemetryFlushError")<{
  message: string;
  eventCount: number;
  cause?: unknown;
}>() {}

/**
 * Union type of all application errors
 */
export type AppError =
  | NotGitRepoError
  | GitCommandError
  | NoApiKeyError
  | AIApiError
  | ConfigError
  | NoChangesError
  | InvalidDateRangeError
  | UserCancelledError
  | TelemetryPersistError
  | TelemetryFlushError;
