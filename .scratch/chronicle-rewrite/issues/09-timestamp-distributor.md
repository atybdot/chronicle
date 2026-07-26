# 09 — TimestampDistributor Agent

**What to build:** The TimestampDistributor agent that assigns realistic timestamps to commit groups, with feature-aware pacing and temporal grouping.

**Blocked by:** 01 (types)

**Status:** done

**Context:** The TimestampDistributor receives `CommitGroup[]` + `CommitMessage[]` and produces `TimestampAssignment[]` — the input for the Orchestrator's plan assembly. Timestamps must look like realistic developer activity, not a batch backfill.

Read the spec at `/home/curtain/development/projects/chronicle/spec.md` section "TimestampDistributor Agent" for the full timestamp generation strategy.

**Location:** Create a new file `apps/cli/src/lib/agents/timestamp-distributor.ts`.

**What TimestampDistributor does (tool-call driven):**

1. **`distribute_timestamps(groups, messages, intent, dateRange)`** — Takes commit groups, messages, user intent, and the target date range. Produces `TimestampAssignment[]` with:
   - `commitDate`: ISO 8601 with timezone
   - `authorDate`: ISO 8601 with timezone
   - `commitDateTz`: timezone offset
   - `authorDateTz`: timezone offset

2. **`analyze_temporal_patterns(dateRange, intent)`** — On-demand: analyzes the target date range to suggest pacing. For example:
   - "feature development" → work during business hours, cluster related commits
   - "cleanup" → spread evenly, can be weekend work
   - "bug fix" → cluster around specific days

**Pacing strategy (from spec):**
- Feature groups are clustered temporally (commits within a feature happen close together)
- Unrelated features have gaps between them (1-3 days)
- Commits within a group are spaced 2-15 minutes apart
- Working hours: 9 AM - 6 PM in the configured timezone
- No commits in the middle of the night (unless intent says otherwise)
- Weekend commits only if intent indicates weekend work

**Implementation approach:**
- Use Vercel AI SDK `generateText` with `maxToolRoundtrips: 5`
- The agent receives groups, messages, intent, and date range
- It calls tools to analyze patterns and distribute timestamps
- Timestamps respect the date range boundaries

**Acceptance criteria:**

- [ ] All timestamps fall within the specified date range
- [ ] Feature groups are clustered temporally (commits in same group are close together)
- [ ] Unrelated features have gaps between them
- [ ] Commits within a group are spaced 2-15 minutes apart
- [ ] Timestamps are within working hours (9 AM - 6 PM) by default
- [ ] Weekend commits only occur if intent indicates weekend work
- [ ] Each commit group gets exactly one `TimestampAssignment`
- [ ] Timezone is consistent across all assignments
- [ ] `analyze_temporal_patterns` provides reasonable pacing suggestions
- [ ] Works with various date ranges (1 day, 1 week, 1 month)
- [ ] Handles edge case: date range too small for all commits (compresses spacing)
