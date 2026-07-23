import { z } from "zod";
import type { HunkSummary, HunkDetail, CommitGroup } from "../../types";
import { CATEGORY_ORDER } from "../../types";

type CommitPlannerResult = {
  groups: CommitGroup[];
} | { error: string };

type HunkDetailResult = {
  hunks: HunkDetail[];
};

function generateGroupId(name: string, index: number): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug}-${index}`;
}

function categorizeHunks(summaries: HunkSummary[]): Map<string, HunkSummary[]> {
  const groups = new Map<string, HunkSummary[]>();
  
  for (const summary of summaries) {
    // Group by file path base (directory + filename without extension)
    const pathParts = summary.filePath.split("/");
    const fileName = pathParts[pathParts.length - 1] ?? "";
    const dir = pathParts.slice(0, -1).join("/") || ".";
    
    // Determine group key based on file patterns
    let groupKey: string;
    
    if (summary.filePath.includes(".test.") || summary.filePath.includes(".spec.")) {
      groupKey = `${dir}/tests`;
    } else if (summary.filePath.includes("migration")) {
      groupKey = `${dir}/migrations`;
    } else if (summary.filePath.includes("config")) {
      groupKey = `${dir}/config`;
    } else {
      groupKey = `${dir}/${fileName.replace(/\.[^.]+$/, "")}`;
    }
    
    const existing = groups.get(groupKey) ?? [];
    existing.push(summary);
    groups.set(groupKey, existing);
  }
  
  return groups;
}

function inferCategory(summaries: HunkSummary[]): CommitGroup["category"] {
  const labels = summaries.flatMap(s => s.semanticLabels);
  
  if (labels.includes("feature")) return "feature";
  if (labels.includes("fix")) return "fix";
  if (labels.includes("test")) return "test";
  if (labels.includes("refactor")) return "refactor";
  if (labels.includes("docs")) return "docs";
  if (labels.includes("style")) return "style";
  if (labels.includes("setup")) return "setup";
  
  return "chore";
}

function inferGroupName(summaries: HunkSummary[], intent?: string): string {
  // If intent is provided, use it to generate group name
  if (intent) {
    const intentLower = intent.toLowerCase();
    if (intentLower.includes("auth")) return "Add authentication";
    if (intentLower.includes("fix")) return "Fix issues";
    if (intentLower.includes("docs")) return "Update documentation";
    if (intentLower.includes("test")) return "Add tests";
    if (intentLower.includes("refactor")) return "Refactor code";
  }
  
  // Otherwise, infer from file paths and labels
  const paths = summaries.map(s => s.filePath);
  const labels = summaries.flatMap(s => s.semanticLabels);
  
  // Check for common patterns
  if (paths.some(p => p.includes("auth"))) return "Add authentication";
  if (paths.some(p => p.includes("pagination"))) return "Fix pagination";
  if (paths.some(p => p.includes("migration"))) return "Add database migration";
  if (labels.includes("test")) return "Add tests";
  if (labels.includes("fix")) return "Fix issues";
  
  // Generate generic name from category
  const category = inferCategory(summaries);
  const categoryNames: Record<string, string> = {
    setup: "Setup project",
    feature: "Add feature",
    fix: "Fix issues",
    refactor: "Refactor code",
    docs: "Update documentation",
    test: "Add tests",
    chore: "Chore",
    style: "Update style",
  };
  
  return categoryNames[category] ?? "Update code";
}

export const CommitPlanner = {
  groupHunks(summaries: HunkSummary[], intent?: string): CommitGroup[] | { error: string } {
    if (summaries.length === 0) {
      return { error: "No hunks to plan" };
    }
    
    const grouped = categorizeHunks(summaries);
    const groups: CommitGroup[] = [];
    let order = 0;
    
    for (const [key, groupSummaries] of grouped) {
      const category = inferCategory(groupSummaries);
      const name = inferGroupName(groupSummaries, intent);
      const groupId = generateGroupId(name, order);
      const filePaths = [...new Set(groupSummaries.map(s => s.filePath))];
      
      groups.push({
        id: groupId,
        name,
        description: `${name} in ${filePaths.join(", ")}`,
        hunkIds: groupSummaries.map(s => s.id),
        filePaths,
        category,
        order,
        dependencies: [],
      });
      
      order++;
    }
    
    // Order groups using shared category order
    groups.sort((a, b) => {
      const catA = CATEGORY_ORDER[a.category] ?? 99;
      const catB = CATEGORY_ORDER[b.category] ?? 99;
      return catA - catB;
    });
    
    // Update order after sorting
    groups.forEach((g, i) => { g.order = i; });
    
    return groups;
  },
  
  requestHunkDetail(hunkIds: string[], details: HunkDetail[]): HunkDetailResult {
    return {
      hunks: details.filter(d => hunkIds.includes(d.hunkId)),
    };
  },
};
