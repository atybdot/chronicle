import { z } from "zod";

// Commit plan schemas
export const FileChangeSchema = z.object({
  path: z.string(),
  status: z.enum(["added", "modified", "deleted", "renamed"]),
  diff: z.string().optional(),
  oldPath: z.string().optional(), // for renames
});

export const PlannedCommitSchema = z.object({
  id: z.string(),
  message: z.string(),
  description: z.string().optional(),
  files: z.array(FileChangeSchema),
  category: z.enum(["setup", "feature", "fix", "refactor", "docs", "test", "chore", "style"]),
  scheduledDate: z.date().optional(),
  dependencies: z.array(z.string()).optional(), // IDs of commits this depends on
});

export const CommitPlanSchema = z.object({
  commits: z.array(PlannedCommitSchema),
  dateRange: z.object({
    start: z.date(),
    end: z.date(),
  }),
  strategy: z.enum(["realistic", "even", "custom"]),
  totalFiles: z.number(),
  estimatedDuration: z.string(),
});

// Config schemas
export const LLMProviderSchema = z.enum(["openai", "anthropic", "gemini", "openrouter", "ollama"]);

export const ConfigSchema = z.object({
  llm: z.object({
    provider: LLMProviderSchema.default("openai"),
    model: z.string().optional(),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(), // for ollama or custom endpoints
    customPrompt: z.string().optional(), // custom instructions appended to AI prompts
  }),
  git: z.object({
    authorName: z.string().optional(),
    authorEmail: z.string().optional(),
  }),
  defaults: z.object({
    distribution: z.enum(["realistic", "even", "custom"]).default("realistic"),
    dryRun: z.boolean().default(true),
    workHoursStart: z.number().min(0).max(23).default(9),
    workHoursEnd: z.number().min(0).max(23).default(18),
    excludeWeekends: z.boolean().default(false),
  }),
});

// Analysis result
export const AnalysisResultSchema = z.object({
  files: z.array(FileChangeSchema),
  suggestedCommits: z.number(),
  suggestedDays: z.number(),
  reasoning: z.string(),
});

// Types
export type FileChange = z.infer<typeof FileChangeSchema>;
export type PlannedCommit = z.infer<typeof PlannedCommitSchema>;
export type CommitPlan = z.infer<typeof CommitPlanSchema>;
export type Config = z.infer<typeof ConfigSchema>;
export type LLMProvider = z.infer<typeof LLMProviderSchema>;
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

// CLI input schemas
export const DateRangeInputSchema = z.union([
  z.object({
    type: z.literal("natural"),
    input: z.string(), // "last 30 days", "spread over 2 weeks"
  }),
  z.object({
    type: z.literal("explicit"),
    start: z.string(), // ISO date string
    end: z.string(),
  }),
]);

export type DateRangeInput = z.infer<typeof DateRangeInputSchema>;
