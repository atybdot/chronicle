# 06 — FileAnalyzer Agent

**What to build:** The FileAnalyzer agent that reads git status, classifies files, extracts hunks with content-based IDs, and produces structured summaries for downstream agents.

**Blocked by:** 01 (types), 02 (git utilities for `getDiffs`, `computeHunkId`)

**Status:** done

**Context:** The FileAnalyzer is the first worker in the pipeline. It takes the raw git state and produces `HunkSummary[]` — the input for CommitPlanner. For large diffs, it can request detail on demand via `get_hunk_detail(hunkIds)`.

Read the spec at `/home/curtain/development/projects/chronicle/spec.md` section "FileAnalyzer Agent" for the full tool definitions and behavior.

**Location:** Create a new file `apps/cli/src/lib/agents/file-analyzer.ts`.

**What FileAnalyzer does (tool-call driven):**

1. **`get_file_changes()`** — Calls git status to get list of changed files with additions/deletions. Returns `FileChange[]`.
2. **`classify_files(changes)`** — Classifies each file as:
   - `analyzable`: source code, config, docs — gets full analysis
   - `asset`: binary, images, lockfiles — skipped with explanation
   - Returns classification map with reasoning per file.
3. **`extract_hunks(changes)`** — For each analyzable file, extracts hunks. Each hunk gets a content-based ID via `computeHunkId(diffContent)`. Returns `HunkSummary[]` with summary text and detail level.
4. **`get_hunk_detail(hunkIds)`** — On-demand: returns full `Hunk[]` content for specific hunk IDs. Used by CommitPlanner when it needs to see the actual code.

**Implementation approach:**
- Use Vercel AI SDK `generateText` with `maxToolRoundtrips: 5`
- Define tools using the `tool` function from `ai`
- The agent receives the git diffs and produces structured output
- Asset classification rules: skip `.png`, `.jpg`, `.gif`, `.ico`, `.woff`, `.woff2`, `.ttf`, `.eot`, `.pdf`, `.zip`, `.tar`, `.gz`, `node_modules/`, `.lock` files, `dist/`, `build/`

**Acceptance criteria:**

- [ ] FileAnalyzer correctly identifies added/modified/deleted files from git status
- [ ] Binary and asset files are classified as non-analyzable with clear reasoning
- [ ] Source code files are classified as analyzable
- [ ] Each hunk gets a content-based ID via `computeHunkId`
- [ ] `HunkSummary` includes file path, header, change type, line counts, and summary text
- [ ] `get_hunk_detail` returns full hunk content for requested IDs
- [ ] `get_hunk_detail` returns empty array for unknown IDs
- [ ] Works with both small diffs (single file) and large diffs (many files)
- [ ] Respects context budget strategy when provided (summary/compact/full detail)
- [ ] Returns error if git status fails
