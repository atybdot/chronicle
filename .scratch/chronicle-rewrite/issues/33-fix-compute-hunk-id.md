# 33 — Fix computeHunkId: Use Diff Content, Not Coordinates

**What to fix:** `computeHunkId` in `file-analyzer.ts` receives line coordinates (`${newStart},${newEnd}`), not diff content. Spec requires content-based IDs for cross-run stability.

**Blocked by:** 06 (FileAnalyzer)

**Status:** done

**Context:** The spec says: "Each hunk gets a content-based ID via `computeHunkId(diffContent)`". The current implementation hashes line numbers, which means:
- Same content at different line positions produces different IDs
- Cross-run stability is broken when code is moved around

**Changes to make:**

1. **Extract actual diff content** for each hunk before calling `computeHunkId`
2. **Hash the diff content** (lines starting with `+`, `-`, and context) instead of coordinates
3. **Update tests** to verify content-based IDs

**Acceptance criteria:**
- [ ] `computeHunkId` receives actual diff content, not line numbers
- [ ] Same diff content at different positions produces same ID
- [ ] Tests verify cross-run stability
