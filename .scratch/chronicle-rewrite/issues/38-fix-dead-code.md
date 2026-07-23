# 38 — Fix Dead Stub and Unused Variable

**What to fix:** `getFileChanges()` returns `[]` with TODO comment. `classifyChangedFiles` has unused variable.

**Blocked by:** 06 (FileAnalyzer)

**Status:** ready-for-agent

**Context:** 
- `getFileChanges()` is a dead stub that returns empty array
- In `classifyChangedFiles`, `const diff = diffs.get(file.path)` is assigned but never used

**Changes to make:**

1. **Remove `getFileChanges()` stub** — not needed, actual implementation is in `runFileAnalyzer`
2. **Remove unused variable** in `classifyChangedFiles`
3. **Verify tests still pass**

**Acceptance criteria:**
- [ ] No dead stubs in production code
- [ ] No unused variables
- [ ] All tests pass
