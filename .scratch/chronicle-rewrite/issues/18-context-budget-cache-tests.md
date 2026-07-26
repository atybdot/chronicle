# 18 — Context Budget + Plan Cache Tests

**What to build:** Tests for the Context Budget pure function and Plan Cache read/write/invalidate operations.

**Blocked by:** 04 (Context Budget), 12 (Plan Cache)

**Status:** done

**Context:** Both Context Budget and Plan Cache are pure functions with no LLM or git dependencies. These tests verify correctness of calculations and cache operations.

**Location:** Create two test files:
- `apps/cli/src/lib/__tests__/context-budget.test.ts`
- `apps/cli/src/lib/__tests__/cache.test.ts`

**Context Budget test cases:**

1. **Strategy Calculation**
   - `< 200 lines` → detail = `"full"`, maxPasses = 1
   - `200-1000 lines` → detail = `"compact"`, maxPasses > 1
   - `> 1000 lines` → detail = `"summary"`, maxPasses > 1
   - `0 lines` → detail = `"full"`, maxPasses = 1 (edge case)
   - Very large effective limit (128K) → maxPasses = 1
   - Very small effective limit (4K) → maxPasses > 1

2. **Hunk Batching**
   - `batchHunksForAnalysis` respects `maxHunksPerPass`
   - `batchHunksForAnalysis` preserves hunk order
   - `batchHunksForAnalysis` with 0 hunks returns empty array
   - `batchHunksForAnalysis` with fewer hunks than limit returns single batch

3. **Summary Merging**
   - `mergeSummaries` flattens batches correctly
   - `mergeSummaries` preserves order
   - `mergeSummaries` with empty batches returns empty array

**Plan Cache test cases:**

1. **Cache Key Generation**
   - `computePlanHash` is deterministic (same inputs → same hash)
   - `computePlanHash` changes when diff changes
   - `computePlanHash` changes when config changes
   - `computePlanHash` changes when intent changes
   - `computePlanHash` changes when ledger state changes

2. **Read/Write**
   - `getCachedPlan` returns null for cache miss
   - `getCachedPlan` returns plan for cache hit
   - `writePlanCache` creates cache directory if needed
   - `writePlanCache` overwrites existing cache
   - `writePlanCache` writes atomically

3. **Execution State**
   - `updateExecutionState` stores state alongside plan
   - `getExecutionState` returns null for missing state
   - `getExecutionState` returns state for existing state

4. **Invalidation**
   - `invalidateCache` deletes plan and state files
   - `invalidateAllCaches` clears entire cache directory
   - `listCachedPlans` returns all cached hashes

5. **Edge Cases**
   - Cache directory doesn't exist (first run)
   - Corrupted cache file (invalid JSON)
   - Very large plan (100+ groups)

**Acceptance criteria:**

- [ ] All Context Budget test cases pass
- [ ] All Plan Cache test cases pass
- [ ] Tests use temp directories for file I/O
- [ ] Tests are pure — no LLM calls, no git operations
- [ ] Tests cover happy path and error paths
- [ ] Tests are fast (< 2 seconds total)
