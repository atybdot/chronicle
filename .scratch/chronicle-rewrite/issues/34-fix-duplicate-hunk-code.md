# 34 — Fix Duplicate Code in Hunk Extraction

**What to fix:** The hunk-pushing block in `extractHunksFromFile` is copy-pasted for the mid-loop save and the final save.

**Blocked by:** 06 (FileAnalyzer)

**Status:** done

**Context:** In `file-analyzer.ts`, the logic to push a hunk to the array appears twice: once inside the `@@` detection loop and once after the loop ends. This violates DRY.

**Changes to make:**

1. **Extract a `pushHunk` helper function** that handles the hunk creation and push logic
2. **Call `pushHunk` from both locations** (mid-loop and post-loop)
3. **Verify tests still pass**

**Acceptance criteria:**
- [ ] No duplicated hunk-pushing logic
- [ ] All existing tests pass
