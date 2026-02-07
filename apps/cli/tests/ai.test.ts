import { describe, expect, test } from "bun:test";
import { __internal, formatAIError, normalizeCommitMessage } from "../src/lib/ai";
import { classifyFileChange } from "../src/lib/file-classification";

describe("normalizeCommitMessage", () => {
  test("trims whitespace and removes trailing period from subject", () => {
    expect(normalizeCommitMessage("  feat: add backfill retries.  ")).toBe("feat: add backfill retries");
  });

  test("only normalizes the subject line", () => {
    expect(normalizeCommitMessage("fix: keep body intact.\n\nBody stays.\n")).toBe("fix: keep body intact\n\nBody stays.");
  });
});

describe("file classification", () => {
  test("keeps docs, config, and lockfiles analyzable", () => {
    expect(
      classifyFileChange({
        file: { path: "pnpm-lock.yaml", status: "modified" },
        diff: "diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml\n@@ -1 +1 @@\n-lock\n+lock2",
      }).kind,
    ).toBe("analyzable");

    expect(
      classifyFileChange({
        file: { path: "README.md", status: "modified" },
        diff: "diff --git a/README.md b/README.md\n@@ -1 +1 @@\n-old\n+new",
      }).kind,
    ).toBe("analyzable");

    expect(
      classifyFileChange({
        file: { path: ".env.example", status: "added" },
        untrackedContent: "API_URL=https://example.com\n",
        untrackedBytes: new TextEncoder().encode("API_URL=https://example.com\n"),
      }).kind,
    ).toBe("analyzable");
  });

  test("marks common binary assets as non-analyzable", () => {
    expect(
      classifyFileChange({
        file: { path: "public/logo.png", status: "added" },
        untrackedBytes: Uint8Array.from([137, 80, 78, 71, 0, 1, 2]),
      }).kind,
    ).toBe("asset");

    expect(
      classifyFileChange({
        file: { path: "fonts/brand.woff2", status: "modified" },
        diff: "Binary files a/fonts/brand.woff2 and b/fonts/brand.woff2 differ",
      }).kind,
    ).toBe("asset");
  });
});

describe("oversized request handling", () => {
  test("detects oversized prompt and TPM limit errors", () => {
    expect(
      __internal.isOversizedRequestError(
        new Error("Request too large for model `openai/gpt-oss-120b`. TPM limit 8000, Requested 10234"),
      ),
    ).toBe(true);

    expect(
      __internal.isOversizedRequestError(
        new Error("Please reduce message size or switch to a model with a larger context window."),
      ),
    ).toBe(true);

    expect(__internal.isOversizedRequestError(new Error("network timeout"))).toBe(false);
  });

  test("formats oversized request errors with reduction guidance", () => {
    expect(
      formatAIError(
        new Error("Request too large for model `openai/gpt-oss-120b`. TPM limit 8000, Requested 10234"),
      ),
    ).toContain("reduced the context as much as it could");
  });

  test("builds an aggressive reduction sequence", () => {
    expect(__internal.buildAdaptiveReductionSequence(120, 8)).toEqual([120, 78, 58, 43, 32, 24, 19, 15, 12, 9, 8]);
    expect(__internal.buildAdaptiveReductionSequence(4, 4)).toEqual([4]);
  });

  test("reduces commit message prompt detail deterministically", () => {
    const commits = [
      {
        category: "feature",
        name: "add adaptive context shrinking for analyze",
        description:
          "Introduce prompt retries that progressively lower hunk coverage while preserving deterministic fallback commits for omitted files.",
        files: [
          { path: "apps/cli/src/lib/ai.ts", status: "modified" as const },
          { path: "apps/cli/src/commands/backfill.ts", status: "modified" as const },
          { path: "apps/cli/tests/ai.test.ts", status: "modified" as const },
        ],
      },
    ];

    const fullPrompt = __internal.buildCommitMessagesBasePrompt(commits, ["feat: keep prompts small"], "full");
    const tinyPrompt = __internal.buildCommitMessagesBasePrompt(commits, ["feat: keep prompts small"], "tiny");

    expect(fullPrompt).toContain("Files: apps/cli/src/lib/ai.ts, apps/cli/src/commands/backfill.ts, apps/cli/tests/ai.test.ts");
    expect(tinyPrompt).not.toContain("Files:");
    expect(tinyPrompt.length).toBeLessThan(fullPrompt.length);
    expect(tinyPrompt).toContain("Use the reduced commit summaries provided here");
  });
});
