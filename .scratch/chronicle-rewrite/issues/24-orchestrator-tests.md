# 24 — Orchestrator Tests

**What to build:** Tests for the full Orchestrator with mocked agent responses, verifying dispatch chain, backprop loop, cache integration, and error handling.

**Blocked by:** 13 (Orchestrator Analysis), 14 (Orchestrator Audit), 15 (Orchestrator Execution)

**Status:** done

**Context:** The Orchestrator coordinates all agents. These tests mock agent responses to verify the dispatch chain, backprop loop, cache integration, and error handling matrix.

**Location:** Create `apps/cli/src/lib/__tests__/orchestrator.test.ts`.

**Test cases to implement:**

1. **Dispatch Chain**
   - FileAnalyzer is called first
   - CommitPlanner is called with FileAnalyzer results
   - MessageWriter is called with CommitPlanner results
   - TimestampDistributor is called with all previous results
   - Each worker uses its configured model

2. **Backprop Loop**
   - Auditor is called after analysis phase
   - Errors trigger re-dispatch of affected groups
   - Only affected groups are re-dispatched (not entire plan)
   - Loop terminates when no errors
   - Loop terminates at max iterations (default 3)
   - Warnings are logged but don't trigger re-dispatch

3. **Cache Integration**
   - Cache is checked before analysis
   - Cache hit loads plan directly
   - Cache is written after audit loop
   - `--regenerate` invalidates cache
   - `--resume` loads execution state

4. **Error Handling**
   - Git status failure → clear error message
   - Config invalid → clear error message
   - No uncommitted changes → early exit (no-op)
   - Agent failure → appropriate error propagation
   - Ledger corruption → clear error message

5. **User Presentation**
   - Plan summary is rendered correctly
   - Dry-run shows plan without executing
   - Approval prompt works correctly
   - Rejection exits cleanly

**Acceptance criteria:**

- [ ] Dispatch chain calls agents in correct order
- [ ] Backprop loop terminates correctly
- [ ] Only affected groups are re-dispatched
- [ ] Cache integration works (hit, miss, invalidate)
- [ ] Error handling covers all failure points
- [ ] User presentation is correct
- [ ] All tests mock agent responses (no real LLM calls)
- [ ] Tests are fast (< 5 seconds total)
