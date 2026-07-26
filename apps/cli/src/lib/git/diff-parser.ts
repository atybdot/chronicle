import { createHash } from "crypto";

export interface FileDiff {
  filePath: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed";
  hunks: HunkDiff[];
}

export interface HunkDiff {
  header: string;
  content: string;
  startLine: number;
  endLine: number;
}

/**
 * Compute SHA-256 hash of hunk diff content.
 * Deterministic: same content → same ID across runs.
 */
export function computeHunkId(diffContent: string): string {
  return createHash("sha256").update(diffContent).digest("hex");
}

/**
 * Parse unified diff text into structured FileDiff objects with hunk IDs.
 */
export function parseDiffs(diffText: string): FileDiff[] {
  const files: FileDiff[] = [];
  const fileSections = diffText.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    const lines = section.split("\n");
    if (lines.length === 0) continue;

    // Parse file path from first line: "a/path b/path"
    const pathMatch = lines[0]?.match(/^a\/(.+?) b\/(.+)$/);
    if (!pathMatch) continue;

    const oldPath = pathMatch[1] ?? "";
    const filePath = pathMatch[2] ?? "";
    const isRename = oldPath !== filePath;

    // Determine status from subsequent lines
    let status: FileDiff["status"] = "modified";
    const statusLine = lines.find((l) => l.startsWith("new file") || l.startsWith("deleted file") || l.startsWith("rename"));
    if (statusLine?.startsWith("new file")) status = "added";
    else if (statusLine?.startsWith("deleted file")) status = "deleted";
    else if (isRename) status = "renamed";

    // Parse hunks
    const hunks: HunkDiff[] = [];
    let currentHunk: HunkDiff | null = null;
    let hunkStartLine = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i] ?? "";

      // Check for hunk header: @@ -start,count +start,count @@
      const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunkMatch) {
        if (currentHunk) {
          hunks.push(currentHunk);
        }
        hunkStartLine = parseInt(hunkMatch[2] ?? "0", 10);
        currentHunk = {
          header: line,
          content: "",
          startLine: hunkStartLine,
          endLine: hunkStartLine,
        };
        continue;
      }

      if (currentHunk) {
        currentHunk.content += line + "\n";
        if (line.startsWith("+") && !line.startsWith("+++")) {
          currentHunk.endLine++;
        } else if (!line.startsWith("-") && !line.startsWith("---")) {
          currentHunk.endLine++;
        }
      }
    }

    if (currentHunk) {
      hunks.push(currentHunk);
    }

    files.push({
      filePath,
      oldPath: isRename ? oldPath : undefined,
      status,
      hunks,
    });
  }

  return files;
}
