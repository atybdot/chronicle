# 35 — Fix Inconsistent .lock File Classification

**What to fix:** `file-analyzer.ts` classifies `.lock` files as assets, but `file-classification.ts` classifies them as analyzable. Two modules disagree on the same extension.

**Blocked by:** 06 (FileAnalyzer)

**Status:** done

**Context:** In `file-analyzer.ts`, `ASSET_EXTENSIONS` includes `.lock`. In `file-classification.ts`, `.lock` is in `ANALYZABLE_EXTENSIONS`. Lock files (e.g., `bun.lock`, `package-lock.json`) are text-based and useful for understanding dependency changes.

**Changes to make:**

1. **Remove `.lock` from `ASSET_EXTENSIONS`** in `file-analyzer.ts`
2. **Let `classifyFiles` from `file-classification.ts`** handle lock file classification
3. **Update tests** to verify lock files are classified correctly

**Acceptance criteria:**
- [ ] `.lock` files are classified consistently across modules
- [ ] Lock files are classified as analyzable (they contain useful dependency info)
