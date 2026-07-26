# 16 — CLI Command (backfill.ts)

**What to build:** The CLI entry point that reads flags, loads config, calls the Orchestrator, renders the plan summary, and handles user approval.

**Blocked by:** 01 (types), 05 (config schema), 15 (full Orchestrator)

**Status:** done

**Context:** This is the user-facing CLI command that ties everything together. It replaces the existing `backfill.ts` with the new multi-agent architecture.

Read the existing `apps/cli/src/commands/backfill.ts` to understand the current implementation. The spec at `/home/curtain/development/projects/chronicle/spec.md` section "CLI Interface" defines the flag set.

**Location:** Modify `apps/cli/src/commands/backfill.ts` (replace existing implementation).

**Flags to support:**

- `--date-range <start>..<end>` — Target date range (required unless in config)
- `--dry-run` — Show plan without executing
- `--output <format>` — Output format: `"summary"` | `"diff"` | `"full"`
- `--regenerate` — Force re-analysis (ignore cache)
- `--resume` — Continue from last successful group
- `--model <model>` — Override model for all agents
- `--provider <provider>` — Override provider for all agents

**CLI flow:**

1. Parse flags with Clack prompts (existing pattern)
2. Load config from `.chronicle/config.json` (or create default)
3. Merge CLI flags into config (flags override config)
4. Call Orchestrator with config + flags
5. Orchestrator returns plan (or loads from cache)
6. Render plan summary:
   - Number of commits
   - Date range
   - Message preview (first 5 commits)
   - File list
   - Audit warnings (if any)
7. If `--dry-run`: show summary and exit
8. Prompt user for approval: "Execute this plan? (y/n)"
9. If approved: Orchestrator dispatches Executor
10. Show execution progress (group by group)
11. Show final summary: commits created, hunk ledger state

**Acceptance criteria:**

- [ ] All flags are parsed correctly
- [ ] Config is loaded from `.chronicle/config.json`
- [ ] CLI flags override config values
- [ ] Plan summary is rendered clearly (commit count, date range, messages)
- [ ] `--dry-run` shows summary without executing
- [ ] `--regenerate` forces re-analysis
- [ ] `--resume` continues from last successful group
- [ ] User is prompted for approval before execution
- [ ] Rejection exits cleanly
- [ ] Execution progress is shown (group by group)
- [ ] Final summary shows commits created and ledger state
- [ ] Works with existing `.chronicle/config.json` files
- [ ] Works without config (uses defaults)
- [ ] Error messages are clear and actionable
