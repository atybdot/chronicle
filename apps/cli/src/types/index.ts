import { z } from "zod";

// ============================================================================
// New Multi-Agent Types (Ticket 01)
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

// Hunk within a file diff
export const HunkSchema = z.object({
  header: z.string(),
  content: z.string(),
  startLine: z.number(),
  endLine: z.number(),
});
export type Hunk = z.infer<typeof HunkSchema>;

// Hunk summary for hierarchical context management
export const HunkSummarySchema = z.object({
  hunkId: z.string(),
  filePath: z.string(),
  header: z.string(),
  changeType: z.enum(["new", "modified", "deleted"]),
  addedLines: z.number(),
  removedLines: z.number(),
  summary: z.string(),
  detailLevel: z.enum(["summary", "compact", "full"]),
});
export type HunkSummary = z.infer<typeof HunkSummarySchema>;

// Full hunk detail (on-demand only)
export const HunkDetailSchema = z.object({
  hunkId: z.string(),
  hunks: z.array(HunkSchema),
});
export type HunkDetail = z.infer<typeof HunkDetailSchema>;

// Commit message with style
export const CommitMessageSchema = z.object({
  subject: z.string(),
  body: z.string().optional(),
  style: z.enum(["conventional", "descriptive", "terse"]),
});
export type CommitMessage = z.infer<typeof CommitMessageSchema>;

// Timestamp assignment for a commit
export const TimestampAssignmentSchema = z.object({
  commitDate: z.string(),
  authorDate: z.string(),
  commitDateTz: z.string(),
  authorDateTz: z.string(),
});
export type TimestampAssignment = z.infer<typeof TimestampAssignmentSchema>;

// Commit group - a logical unit of work
export const CommitGroupSchema = z.object({
  groupId: z.string(),
  message: CommitMessageSchema,
  hunks: z.array(HunkSummarySchema),
  intent: z.string(),
  dependencies: z.array(z.string()),
  order: z.number(),
  timestamps: TimestampAssignmentSchema.optional(),
});
export type CommitGroup = z.infer<typeof CommitGroupSchema>;

// Audit signal from the auditor
export const AuditSignalSchema = z.object({
  type: z.enum([
    "reorder",
    "split",
    "merge",
    "rewrite",
    "message-style",
    "missing-hunks",
    "overlap",
    "warning",
  ]),
  groupId: z.string().optional(),
  hunkId: z.string().optional(),
  message: z.string(),
  severity: z.enum(["error", "warning"]),
});
export type AuditSignal = z.infer<typeof AuditSignalSchema>;

// Hunk ledger for tracking hunk lifecycle
export const HunkLedgerSchema = z.object({
  version: z.number(),
  hunkIds: z.array(z.string()),
  committedHunkIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
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
export const AgentRolesConfigSchema = z.record(
  AgentRoleSchema,
  z.object({
    model: z.string().optional(),
    provider: z.string().optional(),
  }),
);
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
// Legacy Types (kept for backward compatibility)
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
