# 04 — Context Budget

**What to build:** A pure function that determines how to analyze large diffs by calculating an analysis strategy based on available context window.

**Blocked by:** 01 (no type dependencies, but types are the foundation)

**Status:** done

**Context:** Different local models have vastly different context windows (4K to 128K tokens). The Context Budget system calculates how to split analysis work across multiple passes. This is a pure function — no LLM calls, no git operations.

Read the spec at `/home/curtain/development/projects/chronicle/spec.md` section "Context Management" for the full strategy.

**Location:** Create a new file `apps/cli/src/lib/context-budget.ts`.

**Functions to implement:**

- `calculateAnalysisStrategy(totalChangedLines: number, effectiveLimit: number): AnalysisStrategy` — Given the total lines changed in a diff and the effective context limit (from model config), returns an analysis strategy.

**AnalysisStrategy type (define locally in this file):**

```typescript
type AnalysisStrategy = {
  detail: "full" | "compact" | "summary";
  maxPasses: number;
  maxHunksPerPass: number;
  estimatedTokensPerHunk: number;
};
```

**Rules (from spec):**
- `< 200 lines changed`: detail = `"full"`, maxPasses = 1, all hunks in one pass
- `200-1000 lines changed`: detail = `"compact"`, maxPasses = ceil(totalLines / effectiveLimit), hunks batched
- `> 1000 lines changed`: detail = `"summary"`, maxPasses = ceil(totalLines / effectiveLimit), hunks batched
- `estimatedTokensPerHunk` = `Math.ceil(totalChangedLines / effectiveLimit * 100)` (rough heuristic, capped at 500)

**Additional functions:**

- `batchHunksForAnalysis(hunks: HunkSummary[], strategy: AnalysisStrategy): HunkSummary[][]` — Splits hunks into batches respecting `maxHunksPerPass`. Returns array of hunk batches.
- `mergeSummaries(batches: HunkSummary[][]): HunkSummary[]` — Flattens batched summaries back into a single list.

**Acceptance criteria:**

- [ ] `calculateAnalysisStrategy` returns `"full"` detail for < 200 lines
- [ ] `calculateAnalysisStrategy` returns `"compact"` detail for 200-1000 lines
- [ ] `calculateAnalysisStrategy` returns `"summary"` detail for > 1000 lines
- [ ] `maxPasses` is at least 1
- [ ] `maxHunksPerPass` is positive and reasonable (not 0, not > 50)
- [ ] `batchHunksForAnalysis` produces batches that respect `maxHunksPerPass`
- [ ] `batchHunksForAnalysis` preserves hunk order within batches
- [ ] `mergeSummaries` flattens correctly and preserves order
- [ ] All functions are pure — no side effects, no LLM calls, no git operations
- [ ] Functions handle edge cases: 0 hunks, 0 changed lines, very large effective limit
