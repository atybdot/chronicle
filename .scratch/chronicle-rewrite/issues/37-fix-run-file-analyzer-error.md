# 37 — Fix runFileAnalyzer: Add Error Handling

**What to fix:** `runFileAnalyzer` calls `getDiffs` without try/catch. Spec requires "Returns error if git status fails".

**Blocked by:** 06 (FileAnalyzer)

**Status:** done

**Context:** The spec says the agent should "Return error if git status fails". Currently, git failures propagate unhandled, which could crash the CLI.

**Changes to make:**

1. **Wrap `getDiffs` call** in try/catch in `runFileAnalyzer`
2. **Return structured error** when git operations fail
3. **Add test** for git failure scenario

**Acceptance criteria:**
- [ ] Git failures return a structured error, not an unhandled exception
- [ ] Error message is clear and actionable
