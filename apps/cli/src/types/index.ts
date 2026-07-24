import { z } from "zod";

// ============================================================================
// New Multi-Agent Types (Ticket 01) - Aligned with spec.md
// ============================================================================

// Agent roles
export const AgentRoleSchema = z.enum([
  "orchestrator",
  "file-analyzer",
  "commit-planner",
  "message-writer",
  "timestamp-distributor",
  "auditor",
  "executor",
]);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

// File change with line counts
export const FileChangeSchema = z.object({
  path: z.string(),
  status: z.enum(["added", "modified", "deleted", "renamed"]),
  additions: z.number().optional(),
  deletions: z.number().optional(),
  oldPath: z.string().optional(),
  diff: z.string().optional(),
});
export type FileChange = z.infer<typeof FileChangeSchema>;

// Hunk within a file diff (spec-compliant)
export const HunkSchema = z.object({
  id: z.string(), // SHA-256 of hunk content — stable across runs
  filePath: z.string(),
  status: z.enum(["added", "modified", "deleted", "renamed"]),
  hunkIndex: z.number(),
  newStart: z.number(),
  newEnd: z.number(),
  addedLines: z.number(),
  removedLines: z.number(),
  changeType: z.enum(["addition", "deletion", "modification", "mixed"]),
});
export type Hunk = z.infer<typeof HunkSchema>;

// Hunk summary for hierarchical context management (spec-compliant)
export const HunkSummarySchema = z.object({
  id: z.string(),
  filePath: z.string(),
  hunkCount: z.number(),
  addedTotal: z.number(),
  removedTotal: z.number(),
  semanticLabels: z.array(z.string()), // e.g., ["validation", "error-handling", "types"]
  preview: z.string(), // First N lines of the hunk
});
export type HunkSummary = z.infer<typeof HunkSummarySchema>;

// Full hunk detail (on-demand only, spec-compliant)
export const HunkDetailSchema = z.object({
  hunkId: z.string(),
  fullContent: z.string(), // Complete hunk diff text
  surroundingContext: z.string(), // N lines before and after for file-level understanding
});
export type HunkDetail = z.infer<typeof HunkDetailSchema>;

// Commit message (spec-compliant)
export const CommitMessageSchema = z.object({
  groupId: z.string(),
  subject: z.string(), // e.g., "feat: add password validation"
  body: z.string().optional(), // Optional body paragraph
});
export type CommitMessage = z.infer<typeof CommitMessageSchema>;

// Timestamp assignment for a commit (spec-compliant)
export const TimestampAssignmentSchema = z.object({
  groupId: z.string(),
  commitDate: z.string(), // ISO 8601 with timezone
  authorDate: z.string(), // ISO 8601 with timezone
  commitDateTz: z.string(), // timezone offset (e.g., "+05:00")
  authorDateTz: z.string(), // timezone offset (e.g., "+05:00")
  sessionId: z.string(), // Groups commits into coding sessions
});
export type TimestampAssignment = z.infer<typeof TimestampAssignmentSchema>;

// Commit group - a logical unit of work (spec-compliant)
export const CommitGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  hunkIds: z.array(z.string()),
  filePaths: z.array(z.string()),
  category: z.enum(["setup", "feature", "fix", "refactor", "docs", "test", "chore", "style"]),
  order: z.number(),
  dependencies: z.array(z.string()), // IDs of groups that must come before this one
});
export type CommitGroup = z.infer<typeof CommitGroupSchema>;

// Category to conventional commit prefix mapping
export const CATEGORY_PREFIXES: Record<CommitGroup["category"], string> = {
  setup: "chore",
  feature: "feat",
  fix: "fix",
  refactor: "refactor",
  docs: "docs",
  test: "test",
  chore: "chore",
  style: "style",
};

// Category ordering for commit groups
export const CATEGORY_ORDER: Record<CommitGroup["category"], number> = {
  setup: 0,
  feature: 1,
  fix: 2,
  refactor: 3,
  test: 4,
  docs: 5,
  style: 6,
  chore: 7,
};

// Audit signal from the auditor (spec-compliant)
export const AuditSignalSchema = z.object({
  groupId: z.string(),
  issue: z.string(),
  severity: z.enum(["error", "warning"]),
  category: z.enum(["grouping", "message", "timing", "dependency", "overlap", "coverage"]),
  suggestedAction: z.string().optional(), // e.g., "split group into 2", "merge groups 3 and 4"
});
export type AuditSignal = z.infer<typeof AuditSignalSchema>;

// Hunk ledger for tracking hunk lifecycle (spec-compliant)
export const HunkLedgerSchema = z.object({
  gitDiffHash: z.string(), // sha256-of-original-git-diff
  configHash: z.string(), // sha256-of-active-config-slice
  hunks: z.record(
    z.string(),
    z.object({
      id: z.string(),
      file: z.string(),
      hunkIndex: z.number(),
      status: z.enum(["pending", "committed"]),
      commitId: z.string().nullable(),
    }),
  ),
  newFiles: z.record(
    z.string(),
    z.object({
      path: z.string(),
      status: z.enum(["pending", "committed"]),
      commitId: z.string().nullable(),
    }),
  ),
  commits: z.record(
    z.string(),
    z.object({
      message: z.string(),
      hash: z.string().nullable(),
      applied: z.boolean(),
    }),
  ),
  ledgerVersion: z.number(),
});
export type HunkLedger = z.infer<typeof HunkLedgerSchema>;

// Execution state for tracking plan execution
export const ExecutionStateSchema = z.object({
  planHash: z.string(),
  completedGroups: z.array(z.string()),
  failedGroups: z.array(z.string()),
  inProgressGroup: z.string().optional(),
  ledger: HunkLedgerSchema,
});
export type ExecutionState = z.infer<typeof ExecutionStateSchema>;

// Plan hash - SHA-256 of diff + config + intent + ledger state
export type PlanHash = string;

// Complete commit plan (new multi-agent architecture)
export const AgentCommitPlanSchema = z.object({
  planHash: z.string(),
  groups: z.array(CommitGroupSchema),
  timestampAssignments: z.array(TimestampAssignmentSchema),
  auditSignals: z.array(AuditSignalSchema),
  version: z.literal(1),
});
export type AgentCommitPlan = z.infer<typeof AgentCommitPlanSchema>;

// Per-agent model routing config
const AgentRoleConfigSchema = z.object({
  model: z.string().optional(),
  provider: z.string().optional(),
}).refine(
  (config) => config.model !== undefined || config.provider !== undefined,
  { message: "Each agent role must have at least one of model or provider" },
);

// Use a string-keyed record; enum validation is handled by agentRolesValidation refinement
export const AgentRolesConfigSchema = z.record(
  z.string(),
  AgentRoleConfigSchema,
).optional();
export type AgentRolesConfig = z.infer<typeof AgentRolesConfigSchema>;

// Extended Chronicle config for multi-agent architecture
export const ChronicleConfigSchema = z.object({
  llm: z.object({
    selected: z
      .object({
        provider: z.string(),
        model: z.string().optional(),
      })
      .default({ provider: "openrouter" }),
    providers: z
      .array(
        z.object({
          name: z.string(),
          API_TOKEN: z.string().optional(),
          model: z.string().optional(),
          baseUrl: z.string().optional(),
          accountId: z.string().optional(),
          gatewayId: z.string().optional(),
        }),
      )
      .default([]),
    agentRoles: AgentRolesConfigSchema.optional(),
  }),
  defaults: z.object({
    intent: z.string().optional(),
    dateRange: z
      .object({
        start: z.string(),
        end: z.string(),
      })
      .optional(),
    excludePatterns: z.array(z.string()).optional(),
    messageStyle: z.enum(["conventional", "descriptive", "terse"]).default("conventional"),
    autoCommit: z.boolean().default(false),
    backupBranch: z.boolean().default(true),
    branchPrefix: z.string().default("chronicle-backup"),
    output: z.string().optional(),
  }),
});
export type ChronicleConfig = z.infer<typeof ChronicleConfigSchema>;

// ============================================================================
// Legacy Types (kept for backward compatibility - to be deleted per sub-ticket)
// ============================================================================

export interface LineRange {
  start: number;
  end: number;
}

export interface FileHunkSpec {
  path: string;
  hunks: LineRange[];
  hunkIndices?: number[];
}

export const PlannedCommitSchema = z.object({
  id: z.string(),
  message: z.string(),
  description: z.string().optional(),
  files: z.array(FileChangeSchema),
  fileHunks: z
    .array(
      z.object({
        path: z.string(),
        hunks: z.array(
          z.object({
            start: z.number(),
            end: z.number(),
          }),
        ),
        hunkIndices: z.array(z.number()).optional(),
      }),
    )
    .optional(),
  category: z.enum(["setup", "feature", "fix", "refactor", "docs", "test", "chore", "style"]),
  scheduledDate: z.date().optional(),
  dependencies: z.array(z.string()).optional(),
});

export type PlannedCommit = z.infer<typeof PlannedCommitSchema>;

// Legacy commit plan (used by existing commands)
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

// Legacy config schemas
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

export type LLMProvider = z.infer<typeof LLMProviderSchema>;

export const LLMSelectedSchema = z.object({
  provider: LLMProviderSchema.default("openrouter"),
  model: z.string().optional(),
});

export type LLMSelected = z.infer<typeof LLMSelectedSchema>;

export const LLMProviderConfigSchema = z.object({
  name: LLMProviderSchema,
  API_TOKEN: z.string().optional(),
  model: z.string().optional(),
  baseUrl: z.string().optional(),
  accountId: z.string().optional(),
  gatewayId: z.string().optional(),
});

export type LLMProviderConfig = z.infer<typeof LLMProviderConfigSchema>;

export const ConfigSchema = z.object({
  llm: z.object({
    selected: LLMSelectedSchema.default({
      provider: "openrouter",
      model: undefined,
    }),
    providers: z.array(LLMProviderConfigSchema).default([]),
    customPrompt: z.string().optional(),
    agentRoles: AgentRolesConfigSchema.optional(),
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
    intent: z.string().optional(),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

// Analysis result
export const AnalysisResultSchema = z.object({
  files: z.array(FileChangeSchema),
  suggestedCommits: z.number(),
  suggestedDays: z.number(),
  reasoning: z.string(),
});

export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

// CLI input schemas
export const DateRangeInputSchema = z.union([
  z.object({
    type: z.literal("natural"),
    input: z.string(),
  }),
  z.object({
    type: z.literal("explicit"),
    start: z.string(),
    end: z.string(),
  }),
]);

export type DateRangeInput = z.infer<typeof DateRangeInputSchema>;

// Legacy CommitPlan type (for backward compatibility with existing code)
export type CommitPlan = z.infer<typeof CommitPlanSchema>;
