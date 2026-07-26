# 29 — Fix Token Formula Bug in Context Budget

**What to build:** Fix the `estimatedTokensPerHunk` calculation in `context-budget.ts` to match the spec.

**Blocked by:** 04 (Context Budget must be implemented first)

**Status:** done

**Context:** The code review found that the token formula is wrong. The spec says:

```
estimatedTokensPerHunk = Math.ceil(totalChangedLines / effectiveLimit * 100)
```

But the implementation computes:

```typescript
const estimatedTokens = estimateTokensFromChangedLines(totalChangedLines);
const estimatedTokensPerHunk = Math.min(
  Math.ceil(totalChangedLines > 0 ? (estimatedTokens / totalChangedLines) * 10 : 100),
  MAX_TOKENS_PER_HUNK,
);
```

This simplifies to `50` for any non-zero input (since `estimatedTokens = totalLines * 5`), ignoring `effectiveLimit` entirely. The spec's formula adapts to model context size; the implementation does not.

**What to do:**

1. Replace the token estimation formula with the spec's formula
2. Remove the unused `estimateTokensFromChangedLines` function
3. Remove the unused `OVERHEAD` constant
4. Update tests to verify the formula works correctly

**Acceptance criteria:**

- [ ] `estimatedTokensPerHunk` uses the formula `Math.ceil(totalChangedLines / effectiveLimit * 100)`
- [ ] `estimatedTokensPerHunk` is capped at 500
- [ ] `estimateTokensFromChangedLines` function is removed
- [ ] `OVERHEAD` constant is removed
- [ ] All tests pass
