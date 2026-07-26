# Chronicle Rewrite Plan

## What This Document Is

A complete design tree for an agent to pick up and convert into a spec (using to-spec). Every decision is recorded below. Nothing is assumed.

---

## What We're Building

A CLI tool (Bun, monorepo) that uses a **multi-agent AI system** (Vercel AI SDK) to analyze uncommitted git changes and produce a **realistic, coherent git commit history** that looks like real feature development on GitHub.

The agent architecture is the core — providers/models are an abstraction layer swapped in later via AI SDK with minimal code changes.

---

## Design Tree

### R0 — Root Decisions

| # | Decision | Value |
|---|---|---|
| D01 | Scope | Rewrite from scratch in the existing monorepo. Don't refactor the current code — start fresh. |
| D02 | Runtime | Bun |
| D03 | AI Framework | Vercel AI SDK (multi-agent, tool calling) |
| D04 | Interface | CLI-only (current style with Clack prompts) |
| D05 | Local model integration | OpenAI-compatible endpoint. Ollama as the documented/recommended default. |
| D06 | Cloud providers | Keep existing + local as an additional option. Add via AI SDK later — not a priority now. Providers/models are secondary to getting the agent architecture right. |
| D07 | Agent hierarchy | Supervisor (Orchestrator) + sub-agents (workers). Orchestrator dispatches, workers execute with their own tool access. |
| D08 | Model per role | Separate model config per agent role (e.g., Orchestrator uses a capable model, Executor uses a cheaper/faster one). User configurable. |
| D09 | User intent | Free-form instruction stored in config. Orchestrator interprets it at plan time to determine strategy. |
| D10 | Tool granularity | Fine-grained tools (5-8 per agent, not 2-3 coarse tools). |
| D11 | Hunk handling | Send full file content as context when possible. Still ask for hunk-level grouping (don't switch to file-level). |
| D12 | Timestamps | AI produces feature groups AND recommends pacing/temporal grouping. Timestamps are feature-aware. |
| D13 | GitHub graph goal | "Look like real feature development" — coherent narrative across the graph, not just filled squares. |
| D14 | Monorepo structure | Keep the existing Turborepo monorepo (CLI + web app + telemetry worker). |
| D15 | Determinism | Not required. Cache is the source of consistency instead. |

### R1 — Agent Architecture

| # | Decision | Value |
|---|---|---|
| D16 | Agent count | 7 agents: 1 Orchestrator + 5 workers + 1 Auditor |
| D17 | Orchestrator role | Reads user's free-form instruction, checks git status, determines strategy, dispatches workers, collects results, manages the backprop loop with Auditor. |
| D18 | FileAnalyzer role | Reads files, extracts hunks, classifies analyzable vs assets, returns structured hunk descriptors with full file context. |
| D19 | CommitPlanner role | Takes FileAnalyzer output, groups hunks into logical commit groups, determines dependencies and ordering. |
| D20 | MessageWriter role | Takes CommitPlanner groups, generates conventional commit messages with proper context. |
| D21 | TimestampDistributor role | Takes CommitPlanner groups + MessageWriter output, produces timestamps respecting feature coherence and user intent. |
| D22 | Auditor role | Reviews the complete plan. Returns structured error signals per commit group. Does NOT rewrite anything — it marks problems. |
| D23 | Executor role | Stages precise hunks, creates backdated commits, handles git hooks, retries on failure, reports results. |
| D24 | Worker capabilities | Workers have their own tool access (not just prompt-only). E.g., FileAnalyzer can call read_file, get_diff directly. |
| D25 | Supervisor approach | Orchestrator delegates tasks to workers. Not peer-to-peer. |

### R2 — Flow & State Machine

| # | Decision | Value |
|---|---|---|
| D26 | Flow | Orchestrator → FileAnalyzer → CommitPlanner → MessageWriter → TimestampDistributor → Auditor (backprop loop) → User approval → Executor |
| D27 | User approval mode | Plan-then-execute. User reviews the full plan before any commits are made. |
| D28 | Plan mode | Configurable dry-run. Default shows plan and asks for confirmation. Non-dry-run mode also shows plan but auto-executes after confirmation timeout. |
| D29 | Backprop mechanism | Auditor returns structured error signals per commit group (not whole-plan flags). Orchestrator re-dispatches ONLY the affected commit groups to the relevant worker, keeping the rest of the plan intact. Like gradient descent but with prompts. |
| D30 | Auditor signal format | `{ groupId: string, issue: string, severity: "error" | "warning", suggestedAction?: string }` |
| D31 | Auditor criteria | Checks for: incoherent grouping (unrelated changes merged), bad messages (don't match diff), unrealistic timing (wrong pacing), overlap (same hunk in multiple groups), missing files (changed files unassigned). |
| D32 | Max backprop iterations | Configurable (default 3). If Auditor still finds errors after max iterations, present best-effort plan to user with Auditor notes. |
| D33 | Failure handling | Executor retries with adjusted strategy (e.g., --no-verify if hooks fail). Only gives up after configurable retries (default 3). |
| D34 | Partial execution | If some commits succeed and then one fails, the plan is partially applied. User is shown what succeeded and what's pending. Cache tracks this state. |

### R3 — Hunk Accounting (No Double-Staging)

| # | Decision | Value |
|---|---|---|
| D35 | Problem | If two commit groups claim the same hunk, the second `git apply --cached` will fail or silently skip. Current code masks this with `unstageAll()` per commit but doesn't enforce exactly-once semantics. |
| D36 | Solution | Hunk Ledger — a JSON state file tracking every hunk's status. |
| D37 | Ledger location | `.chronicle/hunk-ledger.json` (in repo, not tracked by git — add to .gitignore). |
| D38 | Ledger structure | `{ gitDiffHash, hunks: { [hunkId]: { id, file, status: "pending" | "committed", commitId } }, commits: { [commitId]: { message, applied: boolean } } }` |
| D39 | Hunk ID scheme | Content-based stable IDs (SHA-256 of the hunk diff content), NOT line-number indices. Same diff = same IDs across runs. |
| D40 | Stage flow per commit | 1. Executor checks ledger: all hunkIds must be PENDING. 2. Constructs patch from hunk IDs. 3. `git apply --cached`. 4. Marks hunks COMMITTED with commitId. 5. `git commit`. |
| D41 | Rollback on failure | If commit creation fails, Executor rolls back ledger entries to PENDING and unstages. |
| D42 | New files | Tracked as `path:full` in the ledger. Status same as hunks (PENDING/COMMITTED). Staged via `git add` instead of `git apply --cached`. |

### R4 — Context Management (Large Diffs)

| # | Decision | Value |
|---|---|---|
| D43 | Problem | Models degrade 30-40% before claimed context limit. Small local models have 8K-32K context. Large local models have 128K. "Lost in the middle" — middle of context is ignored. Git diffs can be thousands of lines (>200K tokens). |
| D44 | Solution | Hierarchical summarization with on-demand detail. NOT RAG, NOT sliding window, NOT single-shot. |
| D45 | FileAnalyzer outputs summaries | For each file, returns a compressed summary (hunk count, added/removed lines, change types, semantic labels) without full diff content. |
| D46 | CommitPlanner gets summaries first | Planner sees all file summaries to form a hypothesis about grouping. It does NOT get full diffs upfront. |
| D47 | CommitPlanner requests detail on demand | Planner calls tool `get_hunk_detail(hunkIds: string[])` to get full diff content for only the hunks relevant to its current reasoning step. |
| D48 | Detail levels | Three levels: `full` (<200 lines changed), `compact` (200-1000 lines), `summary` (1000+ lines). Orchestrator picks level based on total changed line count. |
| D49 | Token budget model | Each agent call has a budget: `model.contextWindow * 0.7`. System prompt (~2K) + user instruction (~0.5K) + ledger state (~0.3K) = ~2.8K overhead. Rest is available for diff context. If budget exceeded, reduce detail level. Never fail — degrade gracefully. |

| Total Lines | Strategy | LLM Calls | Context Quality |
|---|---|---|---|
| < 200 | Full diff + full file context | 1 pass | Best |
| 200-1000 | Full hunks, summarized file context | 1-2 passes | Good |
| 1000-5000 | Hunk summaries, drill on demand | 2-3 passes | Adequate |
| 5000+ | Hierarchical: file summaries → group → drill hunk details | 3+ passes | Adequate |

### R5 — Caching (Replaces Determinism)

| # | Decision | Value |
|---|---|---|
| D50 | Purpose | Instead of requiring deterministic output, cache the full plan. Running the same diff twice produces identical UX without re-querying the LLM. |
| D51 | Cache key | `hash(git diff + config + free-form instruction + hunk ledger state)` |
| D52 | Cached value | Full plan (analysis, commit groups, messages, timestamps) + execution state (which commits already applied). |
| D53 | Invalidation | git diff changes, config changes, user clicks "regenerate". NOT time-based. |
| D54 | On cache hit | Retrieve plan → check execution state → if not yet executed, present to user for approval → if fully executed, tell user and offer regenerate. |
| D55 | Partial execution cache | If user ran a plan, 3 commits applied, then cancelled — cache stores this. Next run shows: "3/7 commits already applied. Resume or regenerate?" |

### R6 — User Facing Concepts

| # | Decision | Value |
|---|---|---|
| D56 | User intent config | Free-form text field in `~/.config/chronicle/config.json`. Examples: "Make it look like I worked on this for 2 weeks with weekends off", "I want dense commits, fill every day", "Create a story of feature-by-feature development". Default: empty string (natural work pattern). |
| D57 | Command | `chronicle backfill` (same as current). Accepts `--date-range`, `--dry-run`, `--output` flags. |
| D58 | Interactive flow | Changes found → "Analyzing with AI..." → Plan preview → (if dry-run) "Approve? Modify? Cancel?" → Execute. |

### Open Questions Left for Spec

None. Every architectural decision is settled. The spec writer should focus on:
1. Exact tool definitions (name, input schema, output schema) for each of the 7 agents
2. Exact prompt templates for each agent
3. Hunk Ledger JSON schema
4. Token budget calculation algorithm
5. Configuration schema additions
6. Cache schema and invalidation logic
7. State machine diagram for Orchestrator
8. Error handling matrix (what happens when each tool/agent fails)
