# 22 — MessageWriter + TimestampDistributor Tests

**What to build:** Tests for MessageWriter's commit message generation and TimestampDistributor's timestamp assignment, using mock data.

**Blocked by:** 08 (MessageWriter), 09 (TimestampDistributor)

**Status:** done

**Context:** Both MessageWriter and TimestampDistributor produce output from groups. These tests verify correct message format and timestamp properties using mock `CommitGroup[]` data.

**Location:** Create two test files:
- `apps/cli/src/lib/__tests__/message-writer.test.ts`
- `apps/cli/src/lib/__tests__/timestamp-distributor.test.ts`

**MessageWriter test cases:**

1. **Conventional Commit Format**
   - Subject follows `type(scope): description` format
   - Type is one of: feat, fix, refactor, docs, test, chore, perf, ci, build
   - Subject is under 72 characters
   - Body provides additional context when needed

2. **Style Variations**
   - "conventional" style produces conventional commits
   - "descriptive" style produces descriptive messages
   - "terse" style produces short messages

3. **Style Reference**
   - `get_style_reference` reads recent commit messages
   - Messages match project's voice when style reference available
   - Falls back to default style when reference unavailable

4. **Consistency**
   - Messages are consistent across groups
   - Same voice, same level of detail
   - No mixed styles within a plan

5. **Edge Cases**
   - Single group (one message)
   - Many groups (20+ messages)
   - Groups with no hunks (empty group)
   - Very long change descriptions (truncation)

**TimestampDistributor test cases:**

1. **Timestamp Properties**
   - All timestamps fall within specified date range
   - Timestamps are valid ISO 8601 format
   - Timezone is consistent across assignments

2. **Feature Clustering**
   - Commits within same group are close together (2-15 minutes)
   - Unrelated features have gaps between them (1-3 days)
   - Feature groups are temporally coherent

3. **Pacing**
   - Commits are within working hours (9 AM - 6 PM) by default
   - Weekend commits only if intent indicates weekend work
   - No commits in middle of night

4. **Intent Respect**
   - "feature development" → business hours, clustered
   - "cleanup" → spread evenly, can be weekend
   - "bug fix" → cluster around specific days

5. **Edge Cases**
   - Date range too small for all commits (compress spacing)
   - Single group (one timestamp)
   - Many groups (20+ timestamps)
   - Date range spanning multiple timezones

**Acceptance criteria:**

- [ ] MessageWriter produces valid conventional commit format
- [ ] MessageWriter respects style variations
- [ ] Messages are consistent across groups
- [ ] TimestampDistributor timestamps fall within date range
- [ ] Feature groups are temporally clustered
- [ ] Pacing respects working hours
- [ ] All tests use mock data (no git, no LLM)
- [ ] Tests are fast (< 1 second total)
