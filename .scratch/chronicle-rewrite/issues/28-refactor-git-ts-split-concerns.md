# 28 — Refactor git.ts to Split Concerns

**What to build:** Split the monolithic `git.ts` file into separate modules for better code organization.

**Blocked by:** 02 (Git Utilities must be implemented first)

**Status:** done

**Context:** The current `apps/cli/src/lib/git.ts` file has grown to 800+ lines with multiple responsibilities:
1. Git operations (status, diff, commit, branch)
2. Diff parsing (parseDiffs, computeHunkId)
3. Patch generation (resolveHunkIdToPatch)
4. Hunk staging (stageHunksByIds, stageFullFile)
5. Helper functions (coerceShellOutput, formatGitCommandOutput)

This violates the Single Responsibility Principle and makes the code harder to maintain.

**What to do:**

1. Create `apps/cli/src/lib/git/` directory structure:
   - `index.ts` - Re-exports for backward compatibility
   - `operations.ts` - Core git operations (status, diff, commit, branch)
   - `diff-parser.ts` - Diff parsing and hunk ID computation
   - `patch.ts` - Patch generation and staging
   - `helpers.ts` - Utility functions

2. Move functions to appropriate modules:
   - `isGitRepo`, `getGitRoot`, `getGitStatus`, `getDiff`, `getFileDiff`, etc. → `operations.ts`
   - `computeHunkId`, `parseDiffs` → `diff-parser.ts`
   - `resolveHunkIdToPatch`, `stageHunksByIds`, `stageFullFile` → `patch.ts`
   - `coerceShellOutput`, `formatGitCommandOutput`, `isGitHookError` → `helpers.ts`

3. Update imports in all files that use `git.ts`

4. Re-export everything from `index.ts` for backward compatibility

**Acceptance criteria:**

- [ ] `git.ts` split into logical modules
- [ ] All existing tests pass
- [ ] Typechecking passes
- [ ] Backward compatibility maintained via re-exports
- [ ] Each module has a single responsibility
- [ ] No circular dependencies
