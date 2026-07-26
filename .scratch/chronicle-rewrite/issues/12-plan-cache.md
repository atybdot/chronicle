# 12 — Plan Cache

**What to build:** A file-based cache that stores complete plans keyed by content hash, enabling resume without re-analyzing diffs.

**Blocked by:** 01 (types for `CommitPlan`, `ExecutionState`, `PlanHash`)

**Status:** done

**Context:** The Plan Cache stores the Orchestrator's plan at `~/.cache/chronicle/plans/{planHash}.json`. On resume, if the cache hit matches the current diff + config + intent + ledger state, the plan is loaded directly without re-running agents.

Read the spec at `/home/curtain/development/projects/chronicle/spec.md` section "Plan Cache" for the cache key generation and invalidation rules.

**Location:** Create a new file `apps/cli/src/lib/cache.ts` (replace existing cache implementation).

**Functions to implement:**

- `computePlanHash(diff: string, config: ChronicleConfig, intent: string, ledgerState: HunkLedger): PlanHash` — SHA-256 hash of the concatenation of diff content, serialized config, intent string, and ledger committed hunk IDs. This is the cache key.

- `getCachedPlan(planHash: PlanHash): Result<CommitPlan | null>` — Reads the cached plan for the given hash. Returns `null` if no cache exists (not an error).

- `writePlanCache(plan: CommitPlan, planHash: PlanHash): Result<void>` — Writes the plan to the cache directory. Creates `~/.cache/chronicle/plans/` if it doesn't exist.

- `updateExecutionState(planHash: PlanHash, state: ExecutionState): Result<void>` — Updates the execution state for a cached plan. Stores alongside the plan.

- `getExecutionState(planHash: PlanHash): Result<ExecutionState | null>` — Reads the execution state for a cached plan. Returns `null` if no state exists.

- `invalidateCache(planHash: PlanHash): Result<void>` — Deletes the cached plan and execution state for the given hash. Used when diff/config/intent changes.

- `invalidateAllCaches(): Result<void>` — Deletes all cached plans. Used for `--regenerate` flag.

- `listCachedPlans(): Result<PlanHash[]>` — Lists all cached plan hashes. Used for debugging.

**Cache directory structure:**
```
~/.cache/chronicle/plans/
  {planHash}.json          # CommitPlan
  {planHash}.state.json    # ExecutionState
```

**Acceptance criteria:**

- [ ] `computePlanHash` produces consistent hashes for same inputs
- [ ] `computePlanHash` produces different hashes when diff, config, intent, or ledger state changes
- [ ] `getCachedPlan` returns null for cache miss (not error)
- [ ] `getCachedPlan` returns the plan for cache hit
- [ ] `writePlanCache` creates the cache directory if needed
- [ ] `writePlanCache` overwrites existing cache for same hash
- [ ] `updateExecutionState` stores execution state alongside plan
- [ ] `getExecutionState` returns null for missing state
- [ ] `invalidateCache` deletes both plan and state files
- [ ] `invalidateAllCaches` clears the entire cache directory
- [ ] `listCachedPlans` returns all cached plan hashes
- [ ] Cache files are written atomically (no partial writes)
- [ ] All functions handle missing cache directory gracefully
