# 05 — Config Schema Extension

**What to build:** Extend the existing Chronicle config schema to support per-agent model routing and free-form user intent, while maintaining backward compatibility.

**Blocked by:** 01 (needs `AgentRolesConfig`, `ChronicleConfig` types)

**Status:** done

**Context:** The existing config is defined in `apps/cli/src/lib/config.ts`. Users currently set a single `model` and `provider`. The rewrite adds:
1. `agentRoles` — route different agents to different models (e.g., orchestrator uses a capable model, workers use cheaper ones)
2. `defaults.intent` — free-form string describing what the AI should focus on when creating commits

Read the existing `apps/cli/src/lib/config.ts` to understand the current implementation.

**Changes to make:**

1. **Extend the Zod schema** in config.ts to add:
   - `agentRoles`: optional object with optional `model` and `provider` per agent role
   - `defaults.intent`: optional string

2. **Add validation** for `agentRoles`:
   - Each key must be a valid `AgentRole` (from types)
   - Each value must have at least one of `model` or `provider`

3. **Add helper function:**
   - `resolveModelForAgent(role: AgentRole, config: ChronicleConfig): { model: string, provider: string }` — Returns the model/provider for a given agent role, falling back to the top-level `defaults.model`/`defaults.provider` if not specified per-agent.

4. **Update the default config** to include the new fields as optional (empty/undefined defaults)

5. **Ensure backward compatibility:**
   - Existing configs without `agentRoles` or `intent` must parse successfully
   - The resolved config should fill in defaults for missing agent roles

**Acceptance criteria:**

- [ ] Existing config files without `agentRoles` or `intent` parse without errors
- [ ] `agentRoles` validates correctly — each key is a valid AgentRole
- [ ] `agentRoles` validates correctly — each value has at least model or provider
- [ ] `defaults.intent` accepts any string
- [ ] `resolveModelForAgent` returns per-agent config when specified
- [ ] `resolveModelForAgent` falls back to top-level defaults when per-agent config is missing
- [ ] Invalid `agentRoles` keys produce clear validation errors
- [ ] The config file format is documented in comments or schema description
- [ ] All existing config tests still pass
