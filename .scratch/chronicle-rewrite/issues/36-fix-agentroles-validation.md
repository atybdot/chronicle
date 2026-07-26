# 36 — Fix agentRoles Validation: At Least One Field Required

**What to fix:** `AgentRolesConfigSchema` allows `{ model: undefined, provider: undefined }` to pass validation. Spec requires "each value must have at least one of model or provider".

**Blocked by:** 05 (Config Schema Extension)

**Status:** done

**Context:** The current Zod schema uses `z.object({ model: z.string().optional(), provider: z.string().optional() })` which allows empty objects. Need a refinement to enforce at least one field.

**Changes to make:**

1. **Add Zod refinement** to `AgentRolesConfigSchema` in `types/index.ts`:
   ```typescript
   .refine(
     (val) => Object.values(val).some((config) => config.model || config.provider),
     { message: "Each agent role must have at least one of model or provider" }
   )
   ```
   Wait, actually the refinement should be on each value, not the whole record. Need to use `.refine` on each entry.

2. **Add test** for validation error when both fields are missing

**Acceptance criteria:**
- [ ] Config with `{ "orchestrator": {} }` fails validation
- [ ] Config with `{ "orchestrator": { "model": "gpt-4" } }` passes validation
- [ ] Config with `{ "orchestrator": { "provider": "openrouter" } }` passes validation
- [ ] Clear error message when validation fails
