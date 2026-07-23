# 39 — Fix Broken Indentation in Config Test

**What to fix:** `config.test.ts:318-326` has broken indentation in the `finally` block.

**Blocked by:** 05 (Config Schema Extension)

**Status:** ready-for-agent

**Context:** The `finally` block in the "handleConfigCacheClear removes all cache namespaces" test lost one indentation level, likely from a bad merge.

**Changes to make:**

1. **Fix indentation** in the affected test
2. **Verify test still passes**

**Acceptance criteria:**
- [ ] Indentation is consistent with the rest of the file
- [ ] Test passes
