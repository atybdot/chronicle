import type { HunkSummary } from "../types";

export interface AnalysisStrategy {
  detail: "full" | "compact" | "summary";
  maxPasses: number;
  maxHunksPerPass: number;
  estimatedTokensPerHunk: number;
}

const MAX_TOKENS_PER_HUNK = 500;

/**
 * Calculate analysis strategy based on total changed lines and effective context limit.
 * Rules from spec:
 * - < 200 lines: detail = "full", maxPasses = 1
 * - 200-1000 lines: detail = "compact", maxPasses = ceil(totalLines / effectiveLimit)
 * - > 1000 lines: detail = "summary", maxPasses = ceil(totalLines / effectiveLimit)
 *
 * Token estimation: Math.ceil(totalChangedLines / effectiveLimit * 100), capped at 500
 */
export function calculateAnalysisStrategy(
  totalChangedLines: number,
  effectiveLimit: number,
): AnalysisStrategy {
  let detail: AnalysisStrategy["detail"];
  let maxPasses: number;

  if (totalChangedLines < 200) {
    detail = "full";
    maxPasses = 1;
  } else if (totalChangedLines <= 1000) {
    detail = "compact";
    maxPasses = Math.ceil(totalChangedLines / effectiveLimit);
  } else {
    detail = "summary";
    maxPasses = Math.ceil(totalChangedLines / effectiveLimit);
  }

  // Calculate maxHunksPerPass based on detail level
  let maxHunksPerPass: number;
  switch (detail) {
    case "full":
      maxHunksPerPass = 100; // Unlimited for full detail
      break;
    case "compact":
      maxHunksPerPass = 120;
      break;
    case "summary":
      maxHunksPerPass = 30;
      break;
  }

  // Estimate tokens per hunk (spec formula: totalLines / effectiveLimit * 100, capped at 500)
  const estimatedTokensPerHunk = Math.min(
    Math.ceil(totalChangedLines > 0 ? (totalChangedLines / effectiveLimit) * 100 : 100),
    MAX_TOKENS_PER_HUNK,
  );

  return {
    detail,
    maxPasses,
    maxHunksPerPass,
    estimatedTokensPerHunk,
  };
}

/**
 * Split hunks into batches respecting maxHunksPerPass.
 * Returns array of hunk batches.
 */
export function batchHunksForAnalysis(
  hunks: HunkSummary[],
  strategy: AnalysisStrategy,
): HunkSummary[][] {
  if (hunks.length === 0) {
    return [];
  }

  const batches: HunkSummary[][] = [];
  for (let i = 0; i < hunks.length; i += strategy.maxHunksPerPass) {
    batches.push(hunks.slice(i, i + strategy.maxHunksPerPass));
  }

  return batches;
}

/**
 * Flatten batched summaries back into a single list.
 * Preserves order.
 */
export function mergeSummaries(batches: HunkSummary[][]): HunkSummary[] {
  return batches.flat();
}
