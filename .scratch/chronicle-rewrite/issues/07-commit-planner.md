# 07 — CommitPlanner Agent

**What to build:** The CommitPlanner agent that groups hunks into logical commit groups with dependencies and ordering, respecting user intent and atomic commit principles.

**Blocked by:** 01 (types), 04 (context budget for strategy)

**Status:** done

**Context:** The CommitPlanner receives `HunkSummary[]` from FileAnalyzer and produces `CommitGroup[]` — the input for MessageWriter. It can request additional hunk detail from FileAnalyzer when needed.

Read the spec at `/home/curtain/development/projects/chronicle/spec.md` section "CommitPlanner Agent" for the full tool definitions and grouping strategy.

**Location:** Create a new file `apps/cli/src/lib/agents/commit-planner.ts`.

**What CommitPlanner does (tool-call driven):**

1. **`group_hunks(hunkSummaries, intent)`** — Takes the summaries and user intent, groups them into logical commit groups. Returns `CommitGroup[]` with:
   - Atomic groups: each commit touches one logical concern
   - Dependency ordering: groups that depend on others have `dependencies` and `order` set
   - Intent alignment: groups are organized to match the user's stated intent

2. **`request_hunk_detail(hunkIds)`** — On-demand: requests full hunk content from FileAnalyzer for specific hunks. Used when summaries aren't enough to make a grouping decision.

3. **`set_dependencies(groupId, dependencyIds)`** — Sets dependency relationships between groups. Used for ordering commits correctly (e.g., "add migration" before "use migration").

**Grouping strategy (from spec):**
- Group by feature/concern: "add auth", "fix pagination", "update docs"
- Each group should be independently reviewable
- Group order should be logical: foundations first, then features, then cleanup
- Dependencies: if group B uses something from group A, B depends on A

**Implementation approach:**
- Use Vercel AI SDK `generateText` with `maxToolRoundtrips: 8`
- The agent receives hunk summaries and intent, then calls tools to build the plan
- When the agent needs more detail on specific hunks, it calls `request_hunk_detail`
- When the plan is complete, the agent returns the final `CommitGroup[]`

**Acceptance criteria:**

- [ ] CommitPlanner groups hunks into logical commit groups based on intent
- [ ] Each group has a unique `groupId`
- [ ] Groups respect atomic commit principles (one concern per group)
- [ ] Dependencies between groups are correctly identified and set
- [ ] Group order is logical (foundations → features → cleanup)
- [ ] `request_hunk_detail` returns full hunk content for requested IDs
- [ ] Works with various intents: "feature-focused", "cleanup-focused", "mixed"
- [ ] Handles single-file changes (one group) and multi-file changes (multiple groups)
- [ ] Respects user intent when provided (e.g., "focus on auth changes")
- [ ] Returns error if no hunks to plan (empty diff)
