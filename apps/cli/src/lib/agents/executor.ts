import type { CommitGroup, HunkLedger } from "../../types";
import { $ } from "bun";
import { markCommitted } from "../hunk-ledger";
import { stageHunksByIds as stageHunksByIdsGit, rollbackHunks as rollbackHunksGit, unstageAll as unstageAllGit, stageFullFile as stageFullFileGit, isGitHookError, createCommitWithDate } from "../git";
import type { FileDiff } from "../git";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

type ExecuteGroupInput = {
  group: CommitGroup;
  ledger: HunkLedger;
  diffs: FileDiff[];
  date: string;
  repoRoot?: string;
};

type VerifyHunksPendingInput = {
  hunkIds: string[];
  ledger: HunkLedger;
};

type StageHunksInput = {
  hunkIds: string[];
  diffs: FileDiff[];
  repoRoot?: string;
};

type StageFullFileInput = {
  filePath: string;
  repoRoot?: string;
};

type MarkGroupFailedInput = {
  groupId: string;
  ledger: HunkLedger;
};

type RollbackInput = {
  backupBranch: string;
  ledger: HunkLedger;
  repoRoot?: string;
};

async function createBackupBranch(repoRoot: string): Promise<Result<string>> {
  try {
    await $`git rev-parse HEAD`.cwd(repoRoot).quiet();
  } catch {
    return { ok: false, error: "No commits exist, cannot create backup branch" };
  }

  const branchName = `chronicle-backup-${Date.now()}`;
  await $`git branch ${branchName}`.cwd(repoRoot);
  return { ok: true, value: branchName };
}

async function verifyHunksPending(
  input: VerifyHunksPendingInput
): Promise<Result<void>> {
  const { hunkIds, ledger } = input;
  
  for (const hunkId of hunkIds) {
    const hunk = ledger.hunks[hunkId];
    if (!hunk || hunk.status !== "pending") {
      return {
        ok: false,
        error: `Hunk ${hunkId} is not pending`,
      };
    }
  }
  
  return { ok: true, value: undefined };
}

async function stageHunks(
  input: StageHunksInput
): Promise<Result<void>> {
  const { hunkIds, diffs, repoRoot } = input;
  const cwd = repoRoot ?? process.cwd();
  
  const result = await stageHunksByIdsGit(hunkIds, diffs, cwd);
  return result;
}

async function stageFullFile(
  input: StageFullFileInput
): Promise<Result<void>> {
  const { filePath, repoRoot } = input;
  const cwd = repoRoot ?? process.cwd();
  
  const result = await stageFullFileGit(filePath, cwd);
  return result;
}

async function unstageAll(
  repoRoot?: string
): Promise<Result<void>> {
  const cwd = repoRoot ?? process.cwd();
  await unstageAllGit(cwd);
  return { ok: true, value: undefined };
}

async function handleHookFailure(
  message: string,
  date: string,
  noVerify: boolean,
  repoRoot?: string
): Promise<Result<string>> {
  const cwd = repoRoot ?? process.cwd();
  
  const result = await createCommitWithDate(
    message,
    new Date(date),
    undefined,
    undefined,
    noVerify,
    cwd
  );
  
  return result;
}

async function rollback(
  input: RollbackInput
): Promise<Result<void>> {
  const { backupBranch, repoRoot } = input;
  const cwd = repoRoot ?? process.cwd();
  
  try {
    await $`git reset --hard ${backupBranch}`.cwd(cwd);
    return { ok: true, value: undefined };
  } catch (error) {
    return {
      ok: false,
      error: `Rollback failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function markGroupFailed(
  input: MarkGroupFailedInput
): Promise<Result<HunkLedger>> {
  const { groupId, ledger } = input;
  
  const newCommits = {
    ...ledger.commits,
    [groupId]: {
      message: "",
      hash: null,
      applied: false,
    },
  };
  
  return {
    ok: true,
    value: {
      ...ledger,
      commits: newCommits,
    },
  };
}

export const Executor = {
  createBackupBranch,
  verifyHunksPending,
  stageHunks,
  stageFullFile,
  unstageAll,
  markGroupFailed,
  rollback,

  async executeGroup(
    input: ExecuteGroupInput
  ): Promise<Result<{ commitHash: string; ledger: HunkLedger }>> {
    const { group, ledger, diffs, date, repoRoot } = input;
    
    // Verify all hunks are pending
    const verifyResult = await verifyHunksPending({
      hunkIds: group.hunkIds,
      ledger,
    });
    
    if (!verifyResult.ok) {
      return verifyResult;
    }
    
    // Stage hunks by ID
    const stageResult = await stageHunks({
      hunkIds: group.hunkIds,
      diffs,
      repoRoot,
    });
    
    if (!stageResult.ok) {
      return stageResult;
    }
    
    // Create commit with backdated timestamp
    const commitResult = await createCommitWithDate(
      group.name,
      new Date(date),
      undefined,
      undefined,
      false,
      repoRoot
    );
    
    if (!commitResult.ok) {
      // Check if it's a hook error and retry with --no-verify
      if (isGitHookError(commitResult.error)) {
        const retryResult = await handleHookFailure(
          group.name,
          date,
          true,
          repoRoot
        );
        
        if (!retryResult.ok) {
          // Mark group as failed
          const markResult = await markGroupFailed({
            groupId: group.id,
            ledger,
          });
          
          if (markResult.ok) {
            return {
              ok: false,
              error: `Hook failure after retry: ${retryResult.error}`,
            };
          }
        }
        
        // Use retry result
        const commitHash = retryResult.ok ? retryResult.value : "";
        
        // Mark hunks as committed
        const markResult = markCommitted(group.hunkIds, ledger, commitHash);
        
        if (!markResult.ok) {
          return markResult;
        }
        
        return {
          ok: true,
          value: {
            commitHash,
            ledger: markResult.value,
          },
        };
      }
      
      return commitResult;
    }
    
    // Mark hunks as committed
    const markResult = markCommitted(group.hunkIds, ledger, commitResult.value);
    
    if (!markResult.ok) {
      return markResult;
    }
    
    return {
      ok: true,
      value: {
        commitHash: commitResult.value,
        ledger: markResult.value,
      },
    };
  },
};