# 01 — Types & Schemas

**What to build:** All Zod schemas and TypeScript types for the Chronicle rewrite. These types are the foundation everything else builds on — every subsequent ticket imports from here.

**Blocked by:** None — can start immediately

**Status:** done

**Context:** The existing types live at `apps/cli/src/types/index.ts`. You are replacing them with a new set that supports the multi-agent architecture. Keep the existing type file path. The spec at `/home/curtain/development/projects/chronicle/spec.md` section "Domain Model" and "Data Structures" defines every type precisely. Read that first.

**Key types to define (all with Zod schemas + inferred TypeScript types):**

- `AgentRole` — union: `"orchestrator" | "file-analyzer" | "commit-planner" | "message-writer" | "timestamp-distributor" | "auditor" | "executor"`
- `FileChange` — `{ path: string, status: "added" | "modified" | "deleted" | "renamed", additions: number, deletions: number }`
- `Hunk` — `{ header: string, content: string, startLine: number, endLine: number }`
- `HunkSummary` — `{ hunkId: string, filePath: string, header: string, changeType: "new" | "modified" | "deleted", addedLines: number, removedLines: number, summary: string, detailLevel: "summary" | "compact" | "full" }`
- `HunkDetail` — `{ hunkId: string, hunks: Hunk[] }` (full hunk content, on-demand only)
- `CommitMessage` — `{ subject: string, body?: string, style: "conventional" | "descriptive" | "terse" }`
- `CommitGroup` — `{ groupId: string, message: CommitMessage, hunks: HunkSummary[], intent: string, dependencies: string[], order: number, timestamps?: TimestampAssignment }`
- `TimestampAssignment` — `{ commitDate: string, authorDate: string, commitDateTz: string, authorDateTz: string }`
- `AuditSignal` — `{ type: "reorder" | "split" | "merge" | "rewrite" | "message-style" | "missing-hunks" | "overlap" | "warning", groupId?: string, hunkId?: string, message: string, severity: "error" | "warning" }`
- `HunkLedger` — `{ version: number, hunkIds: string[], committedHunkIds: string[], createdAt: string, updatedAt: string }`
- `ExecutionState` — `{ planHash: string, completedGroups: string[], failedGroups: string[], inProgressGroup?: string, ledger: HunkLedger }`
- `PlanHash` — `string` (SHA-256 of diff + config + intent + ledger state)
- `CommitPlan` — `{ planHash: string, groups: CommitGroup[], timestampAssignments: TimestampAssignment[], auditSignals: AuditSignal[], version: 1 }`
- `AgentRolesConfig` — `{ [key in AgentRole]?: { model?: string, provider?: string } }` — per-agent model routing
- `ChronicleConfig` — extends existing config schema with `agentRoles?: AgentRolesConfig` and `defaults: { intent?: string, dateRange?: { start: string, end: string }, excludePatterns?: string[], messageStyle?: "conventional" | "descriptive" | "terse", autoCommit?: boolean, backupBranch?: boolean, branchPrefix?: string, output?: string }`

**Acceptance criteria:**

- [ ] All types are defined in `apps/cli/src/types/index.ts` with both Zod schema and inferred TS type
- [ ] `ChronicleConfig` is backward compatible — existing configs without `agentRoles` or `intent` still parse successfully
- [ ] All schemas export both the Zod schema and the inferred type
- [ ] `HunkSummary.detailLevel` is required (not optional)
- [ ] `CommitGroup.dependencies` is `string[]` (group IDs this depends on)
- [ ] `CommitGroup.order` is `number` (execution order)
- [ ] `HunkLedger.version` is `number` (currently 1)
- [ ] `CommitPlan.version` is literal `1`
- [ ] `AuditSignal.severity` is `"error" | "warning"` (errors block execution, warnings are advisory)
- [ ] Existing tests that import from types still compile (check for breakage)
