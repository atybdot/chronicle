# 15 — Orchestrator: Execution Phase

**What to build:** Extend the Orchestrator with user presentation, approval flow, cache integration, and Executor dispatch.

**Blocked by:** 14 (audit phase must be complete), 11 (Executor agent), 12 (Plan Cache)

**Status:** done

**Context:** This extends the Orchestrator from ticket 14 with the execution phase. After the audit loop produces a clean plan, the Orchestrator presents it to the user for approval, handles dry-run mode, integrates with the cache, and dispatches the Executor.

Read the spec at `/home/curtain/development/projects/chronicle/spec.md` section "Orchestrator: Execution Phase" for the full execution flow.

**Location:** Modify `apps/cli/src/lib/agents/orchestrator.ts` (from ticket 14).

**What the Execution Phase adds:**

1. **Check cache** — Before analysis, compute plan hash and check cache. If hit and not `--regenerate`, load plan directly.
2. **Write plan cache** — After audit loop completes successfully, write plan to cache.
3. **Present plan** — Render plan summary for user: commit count, date range, message preview, file list.
4. **Handle approval** — Wait for user approval before executing. If rejected, exit cleanly.
5. **Handle dry-run** — If `--dry-run`, show plan but don't execute. Exit after presentation.
6. **Handle regenerate** — If `--regenerate`, invalidate cache and re-run analysis.
7. **Handle resume** — If `--resume`, load execution state from cache and continue from where it left off.
8. **Dispatch Executor** — After approval, dispatch Executor to execute the plan.
9. **Update execution state** — After each group is executed, update execution state in cache.
10. **Create backup branch** — Before execution, create backup branch via Executor.

**Cache flow (from spec):**
- Before analysis: compute hash, check cache
- Cache hit + not regenerate: skip analysis, present cached plan
- Cache miss or regenerate: run full analysis, write cache after audit
- After execution: update execution state in cache
- On resume: load execution state, skip completed groups

**Acceptance criteria:**

- [ ] Cache is checked before analysis (hash = diff + config + intent + ledger state)
- [ ] Cache hit loads plan directly (skips analysis)
- [ ] Cache is written after audit loop completes
- [ ] Plan is presented to user with summary (commit count, date range, messages)
- [ ] User approval is required before execution
- [ ] Rejection exits cleanly without changes
- [ ] `--dry-run` shows plan but doesn't execute
- [ ] `--regenerate` invalidates cache and re-runs analysis
- [ ] `--resume` loads execution state and continues from last successful group
- [ ] Executor is dispatched after approval
- [ ] Execution state is updated after each group
- [ ] Backup branch is created before execution
- [ ] Handles edge case: cache hit but diff changed (cache invalid, re-run analysis)
- [ ] Handles edge case: resume with no previous state (starts from beginning)
