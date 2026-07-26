# 27 — Delete Legacy ConfigSchema Duplication

**What to build:** Remove the duplicate `ConfigSchema` definition and consolidate to a single schema.

**Blocked by:** 01 (Types & Schemas must be implemented first)

**Status:** ready-for-agent

**Context:** The current `apps/cli/src/types/index.ts` has two config schema definitions:
1. The new `ChronicleConfigSchema` (lines 151-189) for the multi-agent architecture
2. The legacy `ConfigSchema` (lines 276-296) used by existing commands

These schemas have overlapping structures (both have `llm.selected`, `llm.providers`) but different field names and structures. This duplication creates confusion and maintenance burden.

**What to do:**

1. Analyze the differences between `ChronicleConfigSchema` and `ConfigSchema`
2. Create a unified schema that supports both legacy and new features
3. Update all code that uses `Config` type to use the new unified schema
4. Remove the duplicate `ConfigSchema` definition
5. Ensure backward compatibility by making new fields optional

**Acceptance criteria:**

- [ ] Single config schema definition in `types/index.ts`
- [ ] All existing tests pass
- [ ] Typechecking passes
- [ ] No duplicate schema definitions
- [ ] Legacy code continues to work with the new schema
- [ ] New multi-agent features are supported
