# 14 — Orchestrator: Audit Phase (Backprop Loop)

**What to build:** Extend the Orchestrator with Auditor integration — a backprop loop that reviews the plan, re-dispatches affected groups to relevant workers, and iterates until the plan is clean.

**Blocked by:** 13 (analysis phase must be complete), 03 (hunk ledger for coverage verification), 10 (Auditor agent)

**Status:** done

**Context:** This extends the Orchestrator from ticket 13 with the audit loop. After the analysis phase assembles a plan, the Orchestrator calls the Auditor to review it. If errors are found, affected groups are re-dispatched to the relevant workers. The loop continues until the Auditor returns no errors or max iterations (default 3) is reached.

Read the spec at `/home/curtain/development/projects/chronicle/spec.md` section "Orchestrator: Backprop Loop" for the full loop logic.

**Location:** Modify `apps/cli/src/lib/agents/orchestrator.ts` (from ticket 13).

**What the Audit Phase adds:**

1. **Call Auditor** — After analysis phase, call `review_plan(plan, ledger)` on the assembled plan
2. **Process signals** — For each error signal:
   - `"reorder"`: Re-dispatch CommitPlanner with affected groups
   - `"split"`: Re-dispatch CommitPlanner to split the problematic group
   - `"merge"`: Re-dispatch CommitPlanner to merge related groups
   - `"rewrite"`: Re-dispatch MessageWriter for affected groups
   - `"missing-hunks"`: Re-dispatch FileAnalyzer + CommitPlanner for missing hunks
   - `"overlap"`: Re-dispatch CommitPlanner to fix overlapping assignments
3. **Re-dispatch affected workers** — Only re-dispatch the specific groups that have errors, not the entire plan
4. **Iterate** — Repeat until Auditor returns no errors or max iterations reached
5. **Best-effort plan** — After max iterations, present the plan as-is with warnings

**Re-dispatch strategy (from spec):**
- Audit signals identify which `groupId` is affected
- Only that group (and its dependents) are re-dispatched to the relevant worker
- Other groups in the plan are untouched
- This minimizes LLM calls and preserves work that's already correct

**Key design decisions:**
- Max iterations: configurable via `defaults.maxIterations` (default 3)
- After max iterations: plan is presented with warnings, not rejected
- Warnings from Auditor are logged but don't trigger re-dispatch
- Each iteration calls Auditor on the updated plan (not just the changed groups)

**Acceptance criteria:**

- [ ] Orchestrator calls Auditor after analysis phase
- [ ] Errors trigger re-dispatch of affected groups to relevant workers
- [ ] Only affected groups are re-dispatched (not entire plan)
- [ ] Warnings are logged but don't trigger re-dispatch
- [ ] Loop continues until no errors or max iterations reached
- [ ] After max iterations, plan is presented with warnings
- [ ] Each iteration calls Auditor on the complete updated plan
- [ ] Re-dispatch correctly identifies which worker to call (CommitPlanner, MessageWriter, etc.)
- [ ] Handles edge case: Auditor returns errors on every iteration (loop terminates at max)
- [ ] Handles edge case: Auditor returns no errors on first iteration (no re-dispatch needed)
