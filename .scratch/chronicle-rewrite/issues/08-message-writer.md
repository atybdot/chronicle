# 08 — MessageWriter Agent

**What to build:** The MessageWriter agent that generates conventional commit messages for each commit group, matching a specified style and maintaining consistency.

**Blocked by:** 01 (types)

**Status:** done

**Context:** The MessageWriter receives `CommitGroup[]` from CommitPlanner and produces `CommitMessage[]` — the input for TimestampDistributor. It supports multiple commit message styles.

Read the spec at `/home/curtain/development/projects/chronicle/spec.md` section "MessageWriter Agent" for the full tool definitions and style guide.

**Location:** Create a new file `apps/cli/src/lib/agents/message-writer.ts`.

**What MessageWriter does (tool-call driven):**

1. **`generate_messages(groups, style)`** — Takes commit groups and a style reference, generates commit messages for each group. Returns `CommitMessage[]` with:
   - `subject`: the first line (conventional commit format)
   - `body`: optional detailed description
   - `style`: the style used

2. **`get_style_reference(repoRoot)`** — On-demand: reads existing commit messages from the repo to match the project's voice. Returns examples of recent commit messages.

**Message styles:**
- `"conventional"`: `feat: add user authentication`, `fix: resolve pagination bug`, `refactor: extract auth service`
- `"descriptive"`: `Add user authentication with JWT tokens`, `Fix pagination bug on large datasets`
- `"terse"`: `auth`, `pagination fix`

**Implementation approach:**
- Use Vercel AI SDK `generateText` with `maxToolRoundtrips: 5`
- The agent receives commit groups and calls tools to generate messages
- It can optionally read the repo's existing commit style via `get_style_reference`
- Each message follows the selected style's conventions

**Acceptance criteria:**

- [ ] MessageWriter generates messages for all commit groups
- [ ] Messages follow conventional commit format when style is "conventional"
- [ ] Messages are descriptive when style is "descriptive"
- [ ] Messages are terse when style is "terse"
- [ ] `get_style_reference` reads recent commit messages from the repo
- [ ] Messages are consistent across groups (same voice, same level of detail)
- [ ] Subject lines are under 72 characters
- [ ] Body provides additional context when needed (complex changes)
- [ ] Works with various group sizes (1 group, 10+ groups)
- [ ] Falls back to a reasonable default message if style reference is unavailable
