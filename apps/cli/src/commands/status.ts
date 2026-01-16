import * as p from "@clack/prompts";
import pc from "picocolors";
import { isGitRepo, getGitStatus, getGitRoot } from "../lib/git";

export async function handleStatus(input?: { path?: string }) {
  const cwd = input?.path ?? process.cwd();

  if (!(await isGitRepo(cwd))) {
    p.cancel("Not a git repository");
    process.exit(1);
  }

  const status = await getGitStatus(cwd);
  const root = await getGitRoot(cwd);

  console.log(pc.bold("\n📁 Repository Status\n"));
  console.log(pc.dim("Root: " + root + "\n"));

  if (status.staged.length > 0) {
    console.log(pc.green("Staged changes:"));
    for (const file of status.staged) {
      console.log("  " + pc.green("+") + " " + file.path + " (" + file.status + ")");
    }
    console.log();
  }

  if (status.unstaged.length > 0) {
    console.log(pc.yellow("Unstaged changes:"));
    for (const file of status.unstaged) {
      console.log("  " + pc.yellow("~") + " " + file.path + " (" + file.status + ")");
    }
    console.log();
  }

  if (status.untracked.length > 0) {
    console.log(pc.red("Untracked files:"));
    for (const path of status.untracked) {
      console.log("  " + pc.red("?") + " " + path);
    }
    console.log();
  }

  const total = status.staged.length + status.unstaged.length + status.untracked.length;

  if (total === 0) {
    console.log(pc.dim("No changes detected"));
  } else {
    console.log(pc.dim("Total: " + total + " files with changes"));
  }
}
