# 13 — Orchestrator: Analysis Phase

**What to build:** The Orchestrator's forward dispatch chain that reads config, checks git state, and calls FileAnalyzer → CommitPlanner → MessageWriter → TimestampDistributor in sequence to assemble a complete plan.

**Blocked by:** 01 (types), 04 (context budget), 05 (config schema), 06 (FileAnalyzer), 07 (CommitPlanner), 08 (MessageWriter), 09 (TimestampDistributor)

**Status:** done

**Context:** This is the first phase of the Orchestrator. It builds the complete forward dispatch chain — no Auditor loop yet. The Orchestrator reads config, gets git diffs, calculates context budget, then dispatches workers in sequence.

Read the spec at `/home/curtain/development/projects/chronicle/spec.md` section "Orchestrator" for the full dispatch flow.

**Location:** Create a new file `apps/cli/src/lib/agents/orchestrator.ts`.

**What the Analysis Phase does:**

1. **Read config** — Load `ChronicleConfig` from the repo's `.chronicle/config.json`
2. **Check git state** — Verify there are uncommitted changes; return early if clean
3. **Get diffs** — Call `getDiffs()` to get current uncommitted changes
4. **Calculate context budget** — Use `calculateAnalysisStrategy` with total changed lines and model effective limit
5. **Initialize hunk ledger** — Read or create the ledger with all hunk IDs from the diff
6. **Filter already-committed hunks** — Use `verifyHunksPending` to exclude already-committed hunks
7. **Dispatch FileAnalyzer** — Call with remaining pending hunks and context strategy
8. **Dispatch CommitPlanner** — Call with FileAnalyzer's summaries + user intent
9. **Dispatch MessageWriter** — Call with CommitPlanner's groups + message style
10. **Dispatch TimestampDistributor** — Call with groups + messages + intent + date range
11. **Assemble plan** — Combine all results into `CommitPlan` object

**Key design decisions:**
- Each worker is called with the config's model routing (use `resolveModelForAgent` from ticket 05)
- The Orchestrator uses the capable model (from `agentRoles.orchestrator` config)
- Workers use their configured models (falling back to top-level defaults)
- The context budget strategy is passed to FileAnalyzer to control detail level

**Acceptance criteria:**

- [ ] Orchestrator reads config from `.chronicle/config.json`
- [ ] Orchestrator verifies there are uncommitted changes
- [ ] Orchestrator calculates context budget from diff size and model limit
- [ ] Orchestrator initializes or reads hunk ledger
- [ ] Orchestrator filters already-committed hunks from the diff
- [ ] FileAnalyzer is called with pending hunks and context strategy
- [ ] CommitPlanner is called with FileAnalyzer summaries and user intent
- [ ] MessageWriter is called with CommitPlanner groups and message style
- [ ] TimestampDistributor is called with groups, messages, intent, and date range
- [ ] All worker results are assembled into a `CommitPlan`
- [ ] Each worker uses its configured model (via `resolveModelForAgent`)
- [ ] Returns error if git status fails
- [ ] Returns error if config is invalid
- [ ] Returns early (no-op) if no uncommitted changes
