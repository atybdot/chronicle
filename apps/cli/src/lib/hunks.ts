import { $ } from "bun";
import type { FileChange } from "../types";

export interface Hunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  content: string;
}

export interface FileHunks {
  path: string;
  status: FileChange["status"];
  hunks: Hunk[];
  fullDiff: string;
  isNewFile: boolean;
  isDeletedFile: boolean;
}

export function parseDiffIntoHunks(diff: string, filePath: string, status: FileChange["status"]): FileHunks {
  const lines = diff.split("\n");
  const hunks: Hunk[] = [];
  
  const isNewFile = status === "added" || lines.some(l => l.startsWith("index 0000000") || l.includes("/dev/null"));
  const isDeletedFile = status === "deleted";
  
  let currentHunk: Hunk | null = null;
  let hunkContent: string[] = [];
  let headerLines: string[] = [];
  let inHunk = false;
  
  for (const line of lines) {
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    
    if (hunkMatch) {
      if (currentHunk) {
        currentHunk.content = hunkContent.join("\n");
        hunks.push(currentHunk);
      }
      
      currentHunk = {
        header: line,
        oldStart: parseInt(hunkMatch[1] ?? "0", 10),
        oldLines: parseInt(hunkMatch[2] ?? "1", 10),
        newStart: parseInt(hunkMatch[3] ?? "0", 10),
        newLines: parseInt(hunkMatch[4] ?? "1", 10),
        content: "",
      };
      hunkContent = [line];
      inHunk = true;
    } else if (inHunk && currentHunk) {
      if (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ") || line.startsWith("\\") || line === "") {
        hunkContent.push(line);
      } else {
        currentHunk.content = hunkContent.join("\n");
        hunks.push(currentHunk);
        currentHunk = null;
        inHunk = false;
      }
    } else if (!inHunk) {
      headerLines.push(line);
    }
  }
  
  if (currentHunk) {
    currentHunk.content = hunkContent.join("\n");
    hunks.push(currentHunk);
  }
  
  return {
    path: filePath,
    status,
    hunks,
    fullDiff: diff,
    isNewFile,
    isDeletedFile,
  };
}

export function createPartialPatch(fileHunks: FileHunks, hunkIndices: number[]): string {
  if (hunkIndices.length === 0) {
    return "";
  }
  
  const lines = fileHunks.fullDiff.split("\n");
  const headerLines: string[] = [];
  const selectedHunks: Hunk[] = [];
  
  for (const line of lines) {
    if (line.startsWith("diff --git") || 
        line.startsWith("index ") || 
        line.startsWith("--- ") || 
        line.startsWith("+++ ") ||
        line.startsWith("new file ") ||
        line.startsWith("deleted file ") ||
        line.startsWith("Binary files ")) {
      headerLines.push(line);
    } else if (line.startsWith("@@")) {
      break;
    }
  }
  
  for (const idx of hunkIndices) {
    const hunk = fileHunks.hunks[idx];
    if (hunk) {
      selectedHunks.push(hunk);
    }
  }
  
  if (selectedHunks.length === 0) {
    return "";
  }
  
  let patch = headerLines.join("\n");
  
  for (const hunk of selectedHunks) {
    patch += "\n" + hunk.content;
  }
  
  return patch;
}

export async function stagePartialPatch(patch: string, cwd?: string): Promise<boolean> {
  if (!patch.trim()) {
    return false;
  }
  
  const workdir = cwd ?? process.cwd();
  
  try {
    const tmpFile = `/tmp/chronicle-patch-${Date.now()}.patch`;
    await Bun.write(tmpFile, patch);
    
    const result = await $`git apply --cached ${tmpFile}`.cwd(workdir).quiet();
    
    await $`rm -f ${tmpFile}`.quiet();
    
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function stageNewFile(filePath: string, content: string, cwd?: string): Promise<boolean> {
  const workdir = cwd ?? process.cwd();
  const gitRoot = await getGitRoot(workdir);
  
  try {
    const tmpFile = `${gitRoot}/${filePath}.chronicle-tmp`;
    await Bun.write(tmpFile, content);
    
    await $`git add -- ${tmpFile}`.cwd(gitRoot);
    await $`git mv -- ${tmpFile} ${filePath}`.cwd(gitRoot).quiet();
    
    return true;
  } catch {
    try {
      await $`rm -f ${gitRoot}/${filePath}.chronicle-tmp`.quiet();
    } catch {}
    return false;
  }
}

export async function getGitRoot(cwd?: string): Promise<string> {
  const result = await $`git rev-parse --show-toplevel`.cwd(cwd ?? process.cwd()).text();
  return result.trim();
}

export function getHunksByRange(fileHunks: FileHunks, ranges: Array<{ start: number; end: number }>): number[] {
  const indices: number[] = [];
  
  for (let i = 0; i < fileHunks.hunks.length; i++) {
    const hunk = fileHunks.hunks[i];
    if (!hunk) continue;
    
    const hunkStart = hunk.newStart;
    const hunkEnd = hunk.newStart + hunk.newLines;
    
    for (const range of ranges) {
      if (hunkStart >= range.start && hunkStart < range.end) {
        if (!indices.includes(i)) {
          indices.push(i);
        }
        break;
      }
      if (hunkEnd > range.start && hunkEnd <= range.end) {
        if (!indices.includes(i)) {
          indices.push(i);
        }
        break;
      }
      if (hunkStart <= range.start && hunkEnd >= range.end) {
        if (!indices.includes(i)) {
          indices.push(i);
        }
        break;
      }
    }
  }
  
  return indices;
}

export function summarizeHunks(fileHunks: FileHunks): string {
  if (fileHunks.hunks.length === 0) {
    return "No changes";
  }
  
  const summaries = fileHunks.hunks.map((h, i) => {
    const addedLines = h.content.split("\n").filter(l => l.startsWith("+") && !l.startsWith("+++")).length;
    const removedLines = h.content.split("\n").filter(l => l.startsWith("-") && !l.startsWith("---")).length;
    return `Hunk ${i + 1}: lines ${h.newStart}-${h.newStart + h.newLines} (+${addedLines}/-${removedLines})`;
  });
  
  return summaries.join("; ");
}
