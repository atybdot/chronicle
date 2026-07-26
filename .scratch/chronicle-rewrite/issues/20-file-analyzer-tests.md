# 20 — FileAnalyzer Tests

**What to build:** Tests for the FileAnalyzer agent against temp git repos, verifying file classification, hunk extraction, and summary generation.

**Blocked by:** 06 (FileAnalyzer Agent)

**Status:** done

**Context:** FileAnalyzer reads git status and produces `HunkSummary[]`. These tests verify correct classification and extraction using real git repos (no LLM mocking for the git parts).

**Location:** Create `apps/cli/src/lib/__tests__/file-analyzer.test.ts`.

**Test cases to implement:**

1. **File Classification**
   - Source code files (.ts, .js, .py, .go) are classified as analyzable
   - Config files (.json, .yaml, .toml) are classified as analyzable
   - Documentation files (.md, .txt) are classified as analyzable
   - Binary files (.png, .jpg, .gif) are classified as assets
   - Lock files (package-lock.json, yarn.lock) are classified as assets
   - Build artifacts (dist/, build/) are classified as assets
   - node_modules/ files are classified as assets

2. **Hunk Extraction**
   - Each hunk gets a content-based ID via `computeHunkId`
   - Hunks include file path, header, change type, line counts
   - Hunks include summary text describing the change
   - Hunks respect context budget strategy (detail level)

3. **Summary Generation**
   - Small diffs (< 200 lines) get full detail
   - Medium diffs (200-1000 lines) get compact detail
   - Large diffs (> 1000 lines) get summary detail
   - Summary text is meaningful (not just "changed file")

4. **Get Hunk Detail**
   - `get_hunk_detail` returns full hunk content for requested IDs
   - `get_hunk_detail` returns empty array for unknown IDs
   - `get_hunk_detail` returns multiple hunks in one call

5. **Edge Cases**
   - Empty diff (no changes)
   - Single file with many hunks
   - Many files with single hunk each
   - Renamed files (detect rename, extract hunks)
   - Deleted files (extract deletion hunks)

**Acceptance criteria:**

- [ ] File classification matches expected categories
- [ ] Each hunk has a unique content-based ID
- [ ] Hunk summaries are meaningful
- [ ] Detail level respects context budget strategy
- [ ] `get_hunk_detail` returns correct content
- [ ] Edge cases are handled gracefully
- [ ] All tests use temp git repos
- [ ] Tests clean up temp directories
- [ ] Tests are isolated (no shared state)
