# 10 — Auditor Agent

**What to build:** The Auditor agent that reviews the complete commit plan and produces structured audit signals identifying issues that need correction.

**Blocked by:** 01 (types), 03 (hunk ledger for coverage verification)

**Status:** done

**Context:** The Auditor is the quality gate in the backprop loop. It receives the complete `CommitPlan` and returns `AuditSignal[]` — structured feedback that the Orchestrator uses to re-dispatch affected groups to workers. Errors block execution; warnings are advisory.

Read the spec at `/home/curtain/development/projects/chronicle/spec.md` section "Auditor Agent" for the full signal definitions.

**Location:** Create a new file `apps/cli/src/lib/agents/auditor.ts`.

**What Auditor does (tool-call driven):**

1. **`review_plan(plan, ledger)`** — Reviews the complete plan and returns signals:
   - `"reorder"` (error): Groups have incorrect dependency ordering
   - `"split"` (error): A group contains unrelated changes that should be split
   - `"merge"` (error): Related changes are split across groups that should be merged
   - `"rewrite"` (error): Messages don't accurately describe changes
   - `"message-style"` (warning): Messages don't match the specified style
   - `"overlap"` (error): Hunk IDs appear in multiple groups
   - `"missing-hunks"` (error): Some hunks from the ledger aren't assigned to any group

2. **`verify_hunk_coverage(groups, ledger)`** — Checks that all pending hunks in the ledger are assigned to exactly one group. Returns signals for:
   - Unassigned hunks (pending hunks not in any group)
   - Overlapping hunks (hunk ID in multiple groups)

**Signal severity:**
- `"error"`: Must be fixed before execution. The Orchestrator re-dispatches affected groups.
- `"warning"`: Advisory. Logged but doesn't block execution.

**Implementation approach:**
- Use Vercel AI SDK `generateText` with `maxToolRoundtrips: 5`
- The agent receives the complete plan and calls tools to verify coverage
- It produces structured `AuditSignal[]` output
- The agent should be conservative — flag potential issues even if unsure

**Acceptance criteria:**

- [ ] Auditor correctly identifies overlapping hunk IDs across groups (error)
- [ ] Auditor correctly identifies unassigned hunks (error)
- [ ] Auditor correctly identifies incorrect dependency ordering (error)
- [ ] Auditor correctly identifies unrelated changes in same group (error)
- [ ] Auditor correctly identifies split related changes (error)
- [ ] Auditor correctly identifies message style mismatches (warning)
- [ ] `verify_hunk_coverage` checks all pending hunks against group assignments
- [ ] Signals include the affected `groupId` and/or `hunkId` when applicable
- [ ] Signals include a clear `message` explaining the issue
- [ ] Returns empty array when plan is valid (no issues found)
- [ ] Works with various plan sizes (1 group, 20+ groups)
