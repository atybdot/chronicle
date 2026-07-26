# 26 — Delete Legacy FileChangeSchema Duplication

**What to build:** Remove the duplicate `FileChangeSchema` definition and consolidate to a single schema.

**Blocked by:** 01 (Types & Schemas must be implemented first)

**Status:** ready-for-agent

**Context:** The current `apps/cli/src/types/index.ts` has two `FileChangeSchema` definitions:
1. The new multi-agent version at the top (lines 20-28) with `additions`, `deletions`, `oldPath`, `diff` fields
2. The legacy version used by `PlannedCommitSchema` (line 210) which references the same schema

This duplication creates confusion and maintenance burden. The new schema should be the single source of truth, and legacy code should be updated to use it or adapted to work with the new schema.

**What to do:**

1. Identify all usages of `FileChange` type in the codebase
2. Update legacy code (`PlannedCommitSchema`, `ConfigSchema`, etc.) to work with the new `FileChangeSchema`
3. Remove any duplicate schema definitions
4. Ensure backward compatibility by making `additions` and `deletions` optional with defaults

**Acceptance criteria:**

- [ ] Single `FileChangeSchema` definition in `types/index.ts`
- [ ] All existing tests pass
- [ ] Typechecking passes
- [ ] No duplicate schema definitions
- [ ] Legacy code continues to work with the new schema
