import type { CommitGroup, HunkLedger, AuditSignal } from "../../types";

type ReviewPlanInput = {
  groups: CommitGroup[];
  ledger: HunkLedger;
};

type VerifyCoverageInput = {
  groups: CommitGroup[];
  ledger: HunkLedger;
};

function buildHunkToGroupsMap(groups: CommitGroup[]): Map<string, string[]> {
  const hunkToGroups = new Map<string, string[]>();
  for (const group of groups) {
    for (const hunkId of group.hunkIds) {
      const existing = hunkToGroups.get(hunkId) || [];
      existing.push(group.id);
      hunkToGroups.set(hunkId, existing);
    }
  }
  return hunkToGroups;
}

function checkOverlappingHunks(groups: CommitGroup[]): AuditSignal[] {
  const signals: AuditSignal[] = [];
  const hunkToGroups = buildHunkToGroupsMap(groups);
  
  for (const [hunkId, groupIds] of hunkToGroups) {
    if (groupIds.length > 1 && groupIds[0]) {
      signals.push({
        groupId: groupIds[0],
        issue: `Hunk ${hunkId} appears in multiple groups: ${groupIds.join(", ")}`,
        severity: "error",
        category: "overlap",
        suggestedAction: `Remove ${hunkId} from all but one group`,
      });
    }
  }
  
  return signals;
}

function checkMissingCoverage(groups: CommitGroup[], ledger: HunkLedger): AuditSignal[] {
  const signals: AuditSignal[] = [];
  const assignedHunks = new Set<string>();
  
  for (const group of groups) {
    for (const hunkId of group.hunkIds) {
      assignedHunks.add(hunkId);
    }
  }
  
  for (const hunkId of Object.keys(ledger.hunks)) {
    const hunk = ledger.hunks[hunkId];
    if (hunk && hunk.status === "pending" && !assignedHunks.has(hunkId)) {
      signals.push({
        groupId: "",
        issue: `Hunk ${hunkId} is pending but not assigned to any group`,
        severity: "error",
        category: "coverage",
        suggestedAction: `Assign ${hunkId} to an appropriate group`,
      });
    }
  }
  
  return signals;
}

function checkDependencyOrdering(groups: CommitGroup[]): AuditSignal[] {
  const signals: AuditSignal[] = [];
  const groupOrder = new Map<string, number>();
  
  for (const group of groups) {
    groupOrder.set(group.id, group.order);
  }
  
  for (const group of groups) {
    for (const depId of group.dependencies) {
      const depOrder = groupOrder.get(depId);
      if (depOrder !== undefined && depOrder >= group.order) {
        signals.push({
          groupId: group.id,
          issue: `Group ${group.id} depends on ${depId} but has order ${group.order} <= ${depOrder}`,
          severity: "error",
          category: "dependency",
          suggestedAction: `Reorder groups so ${depId} comes before ${group.id}`,
        });
      }
    }
  }
  
  return signals;
}

function checkGroupCoherence(groups: CommitGroup[]): AuditSignal[] {
  const signals: AuditSignal[] = [];
  
  for (const group of groups) {
    const categories = new Set<string>();
    for (const filePath of group.filePaths) {
      if (filePath.includes(".test.") || filePath.includes(".spec.")) {
        categories.add("test");
      } else if (filePath.includes("config") || filePath.includes("rc")) {
        categories.add("config");
      } else {
        categories.add("source");
      }
    }
    
    if (categories.has("config") && categories.has("source") && group.filePaths.length > 2) {
      signals.push({
        groupId: group.id,
        issue: `Group ${group.id} may contain unrelated changes: ${group.filePaths.join(", ")}`,
        severity: "warning",
        category: "grouping",
        suggestedAction: `Consider splitting into separate groups`,
      });
    }
  }
  
  return signals;
}

export const Auditor = {
  async review_plan(input: ReviewPlanInput): Promise<{ signals: AuditSignal[] }> {
    const { groups, ledger } = input;
    const signals: AuditSignal[] = [];
    
    signals.push(...checkOverlappingHunks(groups));
    signals.push(...checkMissingCoverage(groups, ledger));
    signals.push(...checkDependencyOrdering(groups));
    signals.push(...checkGroupCoherence(groups));
    
    return { signals };
  },

  async verify_hunk_coverage(input: VerifyCoverageInput): Promise<{
    unassigned: string[];
    overlaps: string[][];
  }> {
    const { groups, ledger } = input;
    const hunkToGroups = buildHunkToGroupsMap(groups);
    const unassigned: string[] = [];
    const overlaps: string[][] = [];
    
    for (const hunkId of Object.keys(ledger.hunks)) {
      const hunk = ledger.hunks[hunkId];
      if (hunk && hunk.status === "pending" && !hunkToGroups.has(hunkId)) {
        unassigned.push(hunkId);
      }
    }
    
    for (const [hunkId, groupIds] of hunkToGroups) {
      if (groupIds.length > 1) {
        overlaps.push([hunkId, ...groupIds]);
      }
    }
    
    return { unassigned, overlaps };
  },
};