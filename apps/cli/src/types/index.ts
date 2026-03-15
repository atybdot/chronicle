import { z } from "zod";

export interface LineRange {
  start: number;
  end: number;
}

export interface FileHunkSpec {
  path: string;
  hunks: LineRange[];
  hunkIndices?: number[]; // Optional: for direct hunk index staging
}

export const FileChangeSchema = z.object({
  path: z.string(),
  status: z.enum(["added", "modified", "deleted", "renamed"]),
  diff: z.string().optional(),
  oldPath: z.string().optional(),
});

export const PlannedCommitSchema = z.object({
  id: z.string(),
  message: z.string(),
  description: z.string().optional(),
  files: z.array(FileChangeSchema),
  fileHunks: z.array(z.object({
    path: z.string(),
    hunks: z.array(z.object({
      start: z.number(),
      end: z.number(),
    })),
    hunkIndices: z.array(z.number()).optional(),
  })).optional(),
  category: z.enum(["setup", "feature", "fix", "refactor", "docs", "test", "chore", "style"]),
  scheduledDate: z.date().optional(),
  dependencies: z.array(z.string()).optional(),
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
export const LLMProviderSchema = z.enum([
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
  "ollama",
  "cloudflare",
  "opencode-zen",
  "groq",
]);

export const LLMSelectedSchema = z.object({
  provider: LLMProviderSchema.default("openrouter"),
  model: z.string().optional(),
});

export const LLMProviderConfigSchema = z.object({
  name: LLMProviderSchema,
  API_TOKEN: z.string().optional(),
  model: z.string().optional(),
  baseUrl: z.string().optional(),
  accountId: z.string().optional(),
  gatewayId: z.string().optional(),
});

export const ConfigSchema = z.object({
  llm: z.object({
    selected: LLMSelectedSchema.default({
      provider: "openrouter",
      model: undefined,
    }),
    providers: z.array(LLMProviderConfigSchema).default([]),
    customPrompt: z.string().optional(),
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
export type LLMSelected = z.infer<typeof LLMSelectedSchema>;
export type LLMProviderConfig = z.infer<typeof LLMProviderConfigSchema>;
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
