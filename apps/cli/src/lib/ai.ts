import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { Result } from "better-result";
import { z } from "zod";
import type { FileChange } from "../types";
import { loadConfig, getApiKey, getCustomPrompt } from "./config";
import { NoApiKeyError, AIApiError } from "./errors";
import { PROVIDER_CONFIG, type ProviderKey } from "./models";
import { getCache, setCache, CacheNamespaces, generateCacheKey } from "./cache";
import { telemetry, categorizeModel, createTimer } from "./telemetry";

const FileHunkSchema = z.object({
  path: z.string().describe("File path"),
  lineRanges: z.array(
    z.object({
      start: z.number().describe("Starting line number in the final file"),
      end: z.number().describe("Ending line number in the final file (exclusive)"),
      description: z.string().optional().describe("Brief description of what these lines do"),
    })
  ).describe("Line ranges in this file that belong to this commit group"),
});

export type AnalysisGroup = {
  name: string;
  description: string;
  files: string[];
  fileHunks: Array<{
    path: string;
    lineRanges: Array<{ start: number; end: number }>;
  }>;
  category: string;
  order: number;
};

/**
 * Append custom prompt to the base prompt if configured
 */
async function buildPrompt(basePrompt: string): Promise<string> {
  const customPrompt = await getCustomPrompt();
  if (customPrompt) {
    return `${basePrompt}\n\n--- Additional Instructions ---\n${customPrompt}`;
  }
  return basePrompt;
}

/**
 * Retry configuration
 */
const RETRY_CONFIG = {
  maxRetries: 5,
  initialDelayMs: 2000,
  maxDelayMs: 30000,
};

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if an error is retryable
 */
function isRetryableError(error: unknown): boolean {
  const errorStr = String(error);
  return (
    // JSON/parsing errors (common with free/small models)
    errorStr.includes("JSON") ||
    errorStr.includes("parse") ||
    errorStr.includes("NoObjectGeneratedError") ||
    errorStr.includes("Unterminated") ||
    errorStr.includes("truncated") ||
    // Network/server errors
    errorStr.includes("fetch") ||
    errorStr.includes("network") ||
    errorStr.includes("ECONNRESET") ||
    errorStr.includes("ETIMEDOUT") ||
    // Rate limits and capacity errors
    errorStr.includes("429") ||
    errorStr.includes("rate limit") ||
    errorStr.includes("503") ||
    errorStr.includes("capacity") ||
    errorStr.includes("Server at capacity") ||
    errorStr.includes("RetryError") ||
    errorStr.includes("isRetryable")
  );
}

/**
 * Format error message for user display
 */
export function formatAIError(error: unknown): string {
  const errorStr = String(error);
  
  if (errorStr.includes("503") || errorStr.includes("capacity")) {
    return "The AI model is currently at capacity. Try again in a few minutes or switch to a different model with 'chronicle config init'.";
  }
  
  if (errorStr.includes("429") || errorStr.includes("rate limit")) {
    return "Rate limit exceeded. Please wait a moment and try again.";
  }
  
  if (errorStr.includes("401") || errorStr.includes("unauthorized") || errorStr.includes("Unauthorized")) {
    return "Invalid API key. Please run 'chronicle config init' to reconfigure.";
  }
  
  if (errorStr.includes("NoObjectGeneratedError") || errorStr.includes("JSON")) {
    return "The AI model returned an invalid response. This often happens with free models. Consider switching to a more capable model.";
  }
  
  if (errorStr.includes("fetch") || errorStr.includes("network")) {
    return "Network error. Please check your internet connection.";
  }
  
  return `AI error: ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Execute a function with exponential backoff retry
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    shouldRetry?: (error: unknown) => boolean;
  } = {},
): Promise<T> {
  const {
    maxRetries = RETRY_CONFIG.maxRetries,
    initialDelayMs = RETRY_CONFIG.initialDelayMs,
    maxDelayMs = RETRY_CONFIG.maxDelayMs,
    shouldRetry = isRetryableError,
  } = options;

  let lastError: unknown;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxRetries || !shouldRetry(error)) {
        throw error;
      }
      
      // Exponential backoff with jitter
      const delay = Math.min(
        initialDelayMs * Math.pow(2, attempt) + Math.random() * 1000,
        maxDelayMs,
      );
      
      await sleep(delay);
    }
  }
  
  throw lastError;
}

/**
 * Wrapper for generateObject with file-based caching and retry logic
 * This provides persistent caching across CLI runs
 */
async function generateObjectWithCache<T>({
  model,
  schema,
  prompt,
  cacheKey,
  ttl,
  requestType,
  provider,
  modelId,
}: {
  model: ReturnType<ReturnType<typeof createOpenAI>>;
  schema: z.ZodSchema<T>;
  prompt: string;
  cacheKey: string;
  ttl?: number;
  requestType: "analyze" | "commit_messages" | "date_parse";
  provider: string;
  modelId: string;
}): Promise<{ object: T }> {
  // Try to get from cache first
  const cached = await getCache<{ object: T }>(cacheKey, {
    namespace: CacheNamespaces.AI_RESPONSES,
    ttl,
  });

  if (cached) {
    telemetry.track({
      event: "ai_request_made",
      properties: {
        provider,
        model_category: categorizeModel(modelId),
        request_type: requestType,
        latency_ms: 0,
        cache_hit: true,
        success: true,
      },
    });
    return cached;
  }

  const timer = createTimer();
  let success = true;
  let errorType: string | undefined;

  try {
    // Generate new response with retry logic
    const result = await withRetry(
      async () => {
        return await generateObject({
          model,
          schema,
          prompt,
        });
      },
      {
        shouldRetry: (error: unknown) => {
          const errorStr = String(error);
          // Retry on JSON/parsing errors (common with free/small models)
          return (
            errorStr.includes("JSON") ||
            errorStr.includes("parse") ||
            errorStr.includes("NoObjectGeneratedError") ||
            errorStr.includes("Unterminated") ||
            errorStr.includes("truncated")
          );
        },
      },
    );

    // Cache the result
    await setCache(cacheKey, result, {
      namespace: CacheNamespaces.AI_RESPONSES,
      ttl,
    });

    return result;
  } catch (error) {
    success = false;
    errorType = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    telemetry.track({
      event: "ai_request_made",
      properties: {
        provider,
        model_category: categorizeModel(modelId),
        request_type: requestType,
        latency_ms: timer(),
        cache_hit: false,
        success,
        error_type: errorType,
      },
    });
  }
}

// Re-export for backward compatibility
export { PROVIDER_CONFIG, type ProviderKey } from "./models";

/**
 * Get the AI model based on config (with Result type)
 */
async function getModelSafe(): Promise<
  Result<ReturnType<ReturnType<typeof createOpenAI>>, NoApiKeyError>
> {
  const config = await loadConfig();
  const apiKey = await getApiKey();

  const provider = config.llm.provider as ProviderKey;
  const providerConfig = PROVIDER_CONFIG[provider];

  if (!providerConfig) {
    return Result.err(new NoApiKeyError({ provider }));
  }

  // Ollama doesn't need an API key
  if (provider !== "ollama" && !apiKey) {
    return Result.err(
      new NoApiKeyError({
        provider: providerConfig.name,
      }),
    );
  }

  switch (provider) {
    case "openai": {
      const openai = createOpenAI({ apiKey });
      return Result.ok(openai(config.llm.model ?? providerConfig.defaultModel));
    }
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey });
      return Result.ok(
        anthropic(config.llm.model ?? providerConfig.defaultModel) as ReturnType<
          ReturnType<typeof createOpenAI>
        >,
      );
    }
    case "gemini": {
      const google = createGoogleGenerativeAI({ apiKey });
      return Result.ok(
        google(config.llm.model ?? providerConfig.defaultModel) as ReturnType<
          ReturnType<typeof createOpenAI>
        >,
      );
    }
    case "openrouter": {
      const openrouter = createOpenAI({
        apiKey,
        baseURL: "https://openrouter.ai/api/v1",
      });
      return Result.ok(openrouter(config.llm.model ?? providerConfig.defaultModel));
    }
    case "ollama": {
      const ollama = createOpenAI({
        baseURL: config.llm.baseUrl ?? "http://localhost:11434/v1",
        apiKey: "ollama",
      });
      return Result.ok(ollama(config.llm.model ?? providerConfig.defaultModel));
    }
    default:
      return Result.err(new NoApiKeyError({ provider }));
  }
}

/**
 * Legacy getModel for backward compatibility
 */
async function getModel() {
  const result = await getModelSafe();
  if (!Result.isOk(result)) {
    throw new Error(result.error.message);
  }
  return result.value;
}

/**
 * Analyze changes and suggest how to split them into atomic commits
 */
export async function analyzeChanges(
  files: FileChange[],
  diffs: Map<string, string>,
  untrackedContent: Map<string, string>,
): Promise<{
  suggestedCommits: number;
  suggestedDays: number;
  reasoning: string;
  groups: Array<{
    name: string;
    description: string;
    files: string[];
    category: string;
    order: number;
  }>;
}> {
  const model = await getModel();

  // Build file summary for the prompt
  const fileSummary = files
    .map((f) => {
      const diff = diffs.get(f.path) ?? untrackedContent.get(f.path) ?? "";
      const truncatedDiff = diff.length > 2000 ? diff.slice(0, 2000) + "\n... (truncated)" : diff;
      return `### ${f.path} (${f.status})\n\`\`\`\n${truncatedDiff}\n\`\`\``;
    })
    .join("\n\n");

  const basePrompt = `You are an expert developer analyzing code changes to create a realistic git commit history.

Analyze the following file changes and determine how to split them into ATOMIC, logical commits that follow best practices:

## CRITICAL: Atomic Commit Guidelines
- SPLIT aggressively: Each commit should contain ONLY related changes that can be understood and reviewed in isolation
- NEVER combine unrelated changes: A bugfix and a feature, or two unrelated features, should be SEPARATE commits
- One concern per commit: If files serve different purposes (e.g., styles, types, implementation), split them
- File-level atomicity: Split files that have unrelated changes within them
- Minimum viable commits: When in doubt, prefer MORE commits over fewer
- Test changes: Group test files with the code they test

## Ordering Requirements
1. Dependencies first: Types/interfaces before implementations, configs before code that uses them
2. No forward dependencies: Earlier commits must not depend on later commits
3. Self-contained: Each commit should work on its own if applied

## Conventional Categories
- setup: Initial setup, configs, dependencies
- feature: New features and functionality
- fix: Bug fixes
- refactor: Code restructuring without behavior change
- docs: Documentation only
- test: Test files
- chore: Maintenance, tooling, build changes
- style: Formatting, linting, cosmetic changes

Files and their changes:
${fileSummary}

Total files: ${files.length}

Provide your analysis with recommended commit groups. Be AGGRESSIVE in splitting - aim for 1-2 files per commit when possible, never combine unrelated changes.`;

  const prompt = await buildPrompt(basePrompt);

  const result = await generateObject({
    model,
    schema: z.object({
      suggestedCommits: z.number().describe("Recommended number of atomic commits"),
      suggestedDays: z
        .number()
        .describe("Recommended number of days to spread commits over for realistic history"),
      reasoning: z.string().describe("Brief explanation of the analysis and recommendations"),
      groups: z.array(
        z.object({
          name: z.string().describe("Short name for this commit group (for the commit message)"),
          description: z.string().describe("What this group of changes accomplishes"),
          files: z.array(z.string()).describe("File paths belonging to this group"),
          category: z
            .enum(["setup", "feature", "fix", "refactor", "docs", "test", "chore", "style"])
            .describe("Type of change"),
          order: z
            .number()
            .describe("Execution order (lower = earlier). Consider dependencies between files."),
        }),
      ),
    }),
    prompt,
  });

  return result.object;
}

/**
 * Analyze changes with Result type for error handling
 */
export async function analyzeChangesSafe(
  files: FileChange[],
  diffs: Map<string, string>,
  untrackedContent: Map<string, string>,
): Promise<
  Result<
    {
      suggestedCommits: number;
      suggestedDays: number;
      reasoning: string;
      groups: Array<AnalysisGroup>;
    },
    NoApiKeyError | AIApiError
  >
> {
  const fileSummary = files
    .map((f) => {
      const diff = diffs.get(f.path) ?? untrackedContent.get(f.path) ?? "";
      const truncatedDiff = diff.length > 3000 ? diff.slice(0, 3000) + "\n... (truncated)" : diff;
      const lineCount = truncatedDiff.split("\n").length;
      return `### ${f.path} (${f.status}) - ${lineCount} lines\n\`\`\`diff\n${truncatedDiff}\n\`\`\``;
    })
    .join("\n\n");

  const basePrompt = `You are an expert developer analyzing code changes to create atomic, well-structured git commits.

## Task
Analyze the following file changes and determine how to split them into ATOMIC commits. You MUST specify which LINE RANGES in each file belong to each commit.

## CRITICAL: Line Range Requirements
- For EVERY file in a commit group, specify the exact line ranges (start-end) that belong to that commit
- Line numbers refer to the NEW/modified file (the result after changes)
- For new files, the line range is typically the entire file content
- For deletions, specify the ranges that were deleted
- Split files at logical boundaries: different functions, classes, or logical sections
- Line ranges should NOT overlap between commit groups for the same file

## Atomic Commit Guidelines
- Each commit should contain ONLY related changes
- Split aggressively: prefer more commits over fewer
- Group related hunks together, even if from different files
- Consider dependencies: types before implementations

## Categories
- setup: Initial setup, configs, dependencies
- feature: New features and functionality  
- fix: Bug fixes
- refactor: Code restructuring without behavior change
- docs: Documentation only
- test: Test files
- chore: Maintenance, tooling, build changes
- style: Formatting, linting, cosmetic changes

## Files and their changes:
${fileSummary}

Total files: ${files.length}

Provide commit groups with SPECIFIC line ranges for each file. Be precise with line numbers.`;

  const prompt = await buildPrompt(basePrompt);
  const cacheKey = generateCacheKey({ prompt, fileSummary });

  return Result.gen(async function* () {
    const model = yield* Result.await(getModelSafe());
    const config = await loadConfig();

    const apiResult = yield* Result.await(
      Result.tryPromise(
        {
          try: () =>
            generateObjectWithCache({
              model,
              schema: z.object({
                suggestedCommits: z.number(),
                suggestedDays: z.number(),
                reasoning: z.string(),
                groups: z.array(
                  z.object({
                    name: z.string(),
                    description: z.string(),
                    files: z.array(z.string()),
                    fileHunks: z.array(FileHunkSchema),
                    category: z.enum([
                      "setup",
                      "feature",
                      "fix",
                      "refactor",
                      "docs",
                      "test",
                      "chore",
                      "style",
                    ]),
                    order: z.number(),
                  }),
                ),
              }),
              prompt,
              cacheKey,
              ttl: 24 * 60 * 60 * 1000,
              requestType: "analyze",
              provider: config.llm.provider,
              modelId: config.llm.model ?? "",
            }),
          catch: (e) => {
            return new AIApiError({
              provider: config.llm.provider,
              message: e instanceof Error ? e.message : String(e),
              cause: e,
            });
          },
        },
        {
          retry: {
            times: 3,
            delayMs: 1000,
            backoff: "exponential",
            shouldRetry: (e) => {
              const message =
                e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase();
              return (
                message.includes("rate limit") ||
                message.includes("timeout") ||
                message.includes("network") ||
                message.includes("503") ||
                message.includes("529") ||
                message.includes("overloaded")
              );
            },
          },
        },
      ),
    );

    const groups: AnalysisGroup[] = apiResult.object.groups.map((g) => ({
      name: g.name,
      description: g.description,
      files: g.files,
      fileHunks: g.fileHunks.map((fh) => ({
        path: fh.path,
        lineRanges: fh.lineRanges.map((lr) => ({ start: lr.start, end: lr.end })),
      })),
      category: g.category,
      order: g.order,
    }));

    return Result.ok({
      suggestedCommits: apiResult.object.suggestedCommits,
      suggestedDays: apiResult.object.suggestedDays,
      reasoning: apiResult.object.reasoning,
      groups,
    });
  });
}

/**
 * Generate commit messages for planned commits
 */
export async function generateCommitMessages(
  commits: Array<{
    files: FileChange[];
    category: string;
    name: string;
    description: string;
  }>,
  existingMessages: string[] = [],
): Promise<string[]> {
  const model = await getModel();
  const config = await loadConfig();

  const styleHint =
    existingMessages.length > 0
      ? `\nExisting commit message style in this repo:\n${existingMessages.slice(0, 5).join("\n")}`
      : "";

  const basePrompt = `Generate commit messages for the following commits. Use conventional commit format (type: description).

IMPORTANT: These commits should already be ATOMIC - each represents a single, self-contained change. Generate messages that reflect this atomic nature.
${styleHint}

Commits to generate messages for:
${commits
  .map(
    (c, i) => `
${i}. Category: ${c.category}
   Name: ${c.name}
   Description: ${c.description}
   Files: ${c.files.map((f) => f.path).join(", ")}
`,
  )
  .join("\n")}

Generate concise but descriptive commit messages. Focus on "why" not "what". Each message should clearly convey the purpose of this atomic change.}`;

  const promptText = await buildPrompt(basePrompt);

  // Generate cache key
  const cacheKey = generateCacheKey({ prompt: promptText, commitCount: commits.length });

  const result = await generateObjectWithCache({
    model,
    schema: z.object({
      messages: z.array(
        z.object({
          message: z.string().describe("Commit message following conventional commits format"),
          index: z.number().describe("Index of the commit this message is for"),
        }),
      ),
    }),
    prompt: promptText,
    cacheKey,
    ttl: 24 * 60 * 60 * 1000, // 24 hours
    requestType: "commit_messages",
    provider: config.llm.provider,
    modelId: config.llm.model ?? "",
  });

  // Sort by index and return messages
  return result.object.messages.sort((a, b) => a.index - b.index).map((m) => m.message);
}

/**
 * Parse natural language date range
 */
export async function parseDateRange(input: string): Promise<{ start: Date; end: Date }> {
  const model = await getModel();
  const config = await loadConfig();
  const now = new Date();

  const promptText = `Parse this natural language date range into day offsets from today.
Today is: ${now.toISOString().split("T")[0]}

Input: "${input}"

Examples:
- "last 30 days" -> startOffset: 30, endOffset: 0
- "spread over 2 weeks" -> startOffset: 14, endOffset: 0
- "past week" -> startOffset: 7, endOffset: 0
- "last month" -> startOffset: 30, endOffset: 0

Return the offsets as positive integers.`;

  // Generate cache key
  const cacheKey = generateCacheKey({ prompt: promptText, today: now.toISOString().split("T")[0] });

  const result = await generateObjectWithCache({
    model,
    schema: z.object({
      startOffset: z.number().describe("Days before today for start date (positive number)"),
      endOffset: z.number().describe("Days before today for end date (0 = today)"),
    }),
    prompt: promptText,
    cacheKey,
    ttl: 7 * 24 * 60 * 60 * 1000, // 7 days - date parsing results don't change often
    requestType: "date_parse",
    provider: config.llm.provider,
    modelId: config.llm.model ?? "",
  });

  const start = new Date(now);
  start.setDate(start.getDate() - result.object.startOffset);

  const end = new Date(now);
  end.setDate(end.getDate() - result.object.endOffset);

  return { start, end };
}
