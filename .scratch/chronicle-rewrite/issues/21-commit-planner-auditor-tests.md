# 21 — CommitPlanner + Auditor Tests

**What to build:** Tests for CommitPlanner's grouping logic and Auditor's signal generation, using mock data.

**Blocked by:** 07 (CommitPlanner), 10 (Auditor)

**Status:** done

**Context:** Both CommitPlanner and Auditor work with plan structures. These tests verify correct grouping, dependency ordering, and signal generation using mock `HunkSummary[]` and `CommitPlan` data.

**Location:** Create two test files:
- `apps/cli/src/lib/__tests__/commit-planner.test.ts`
- `apps/cli/src/lib/__tests__/auditor.test.ts`

**CommitPlanner test cases:**

1. **Grouping Logic**
   - Groups hunks by feature/concern based on intent
   - Each group has unique `groupId`
   - Groups respect atomic commit principles
   - Single-file changes produce single group
   - Multi-file changes produce multiple groups

2. **Dependency Ordering**
   - Dependencies are correctly identified
   - `order` field reflects dependency chain
   - Circular dependencies are handled (error or warning)
   - Independent groups have no dependencies

3. **Intent Alignment**
   - "feature-focused" intent groups by feature
   - "cleanup-focused" intent groups by cleanup task
   - "mixed" intent balances features and cleanup

4. **Detail Request**
   - `request_hunk_detail` returns full hunk content
   - `request_hunk_detail` handles unknown IDs

**Auditor test cases:**

1. **Signal Generation**
   - Identifies overlapping hunk IDs (error)
   - Identifies unassigned hunks (error)
   - Identifies incorrect dependency ordering (error)
   - Identifies unrelated changes in same group (error)
   - Identifies split related changes (error)
   - Identifies message style mismatches (warning)

2. **Coverage Verification**
   - `verify_hunk_coverage` checks all pending hunks
   - Returns empty array when plan is valid
   - Returns signals for each issue found

3. **Signal Properties**
   - Each signal has correct `type`, `severity`, `message`
   - Signals include affected `groupId` when applicable
   - Signals include affected `hunkId` when applicable

4. **Edge Cases**
   - Plan with 0 groups (empty)
   - Plan with 1 group (no dependencies)
   - Plan with 20+ groups (many dependencies)
   - Plan with all hunks assigned (no missing)
   - Plan with no hunks assigned (all missing)

**Acceptance criteria:**

- [ ] CommitPlanner groups hunks correctly by intent
- [ ] CommitPlanner sets dependencies correctly
- [ ] CommitPlanner respects atomic commit principles
- [ ] Auditor generates correct signals for each issue type
- [ ] Auditor returns empty array for valid plan
- [ ] Auditor signals include affected group/hunk IDs
- [ ] All tests use mock data (no git, no LLM)
- [ ] Tests are fast (< 1 second total)
