import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { $ } from "bun";
import { MessageWriter } from "../src/lib/agents/message-writer";
import type { CommitGroup, CommitMessage } from "../src/types";

describe("MessageWriter", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "message-writer-test-"));
    await $`git init`.cwd(tempDir);
    await $`git config user.email "test@test.com"`.cwd(tempDir);
    await $`git config user.name "Test"`.cwd(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("generate_messages", () => {
    test("generates messages for all commit groups", () => {
      const groups: CommitGroup[] = [
        {
          id: "group-1",
          name: "Add authentication",
          description: "Add user authentication",
          hunkIds: ["hunk-1"],
          filePaths: ["src/auth.ts"],
          category: "feature",
          order: 0,
          dependencies: [],
        },
        {
          id: "group-2",
          name: "Fix pagination",
          description: "Fix pagination bug",
          hunkIds: ["hunk-2"],
          filePaths: ["src/pagination.ts"],
          category: "fix",
          order: 1,
          dependencies: [],
        },
      ];

      const messages = MessageWriter.generateMessages(groups, { messages: [] });
      
      expect(messages.length).toBe(2);
      expect(messages[0]?.groupId).toBe("group-1");
      expect(messages[1]?.groupId).toBe("group-2");
    });

    test("messages follow conventional commit format", () => {
      const groups: CommitGroup[] = [
        {
          id: "group-1",
          name: "Add authentication",
          description: "Add user authentication",
          hunkIds: ["hunk-1"],
          filePaths: ["src/auth.ts"],
          category: "feature",
          order: 0,
          dependencies: [],
        },
      ];

      const messages = MessageWriter.generateMessages(groups, { messages: [] });
      
      expect(messages.length).toBe(1);
      expect(messages[0]?.subject).toMatch(/^feat: .+/);
    });

    test("messages are descriptive when style is descriptive", () => {
      const groups: CommitGroup[] = [
        {
          id: "group-1",
          name: "Add authentication",
          description: "Add user authentication with JWT tokens",
          hunkIds: ["hunk-1"],
          filePaths: ["src/auth.ts"],
          category: "feature",
          order: 0,
          dependencies: [],
        },
      ];

      const messages = MessageWriter.generateMessages(groups, { messages: ["Add authentication with JWT tokens"] });
      
      expect(messages.length).toBe(1);
      expect(messages[0]?.subject).toContain("authentication");
      expect(messages[0]?.subject).not.toMatch(/^feat: /);
    });

    test("messages are terse when style is terse", () => {
      const groups: CommitGroup[] = [
        {
          id: "group-1",
          name: "Add authentication",
          description: "Add user authentication",
          hunkIds: ["hunk-1"],
          filePaths: ["src/auth.ts"],
          category: "feature",
          order: 0,
          dependencies: [],
        },
      ];

      const messages = MessageWriter.generateMessages(groups, { messages: ["auth"] });
      
      expect(messages.length).toBe(1);
      expect(messages[0]?.subject.length).toBeLessThan(20);
    });

    test("subject lines are under 72 characters", () => {
      const groups: CommitGroup[] = [
        {
          id: "group-1",
          name: "Add very long feature that exceeds the character limit",
          description: "Add very long feature",
          hunkIds: ["hunk-1"],
          filePaths: ["src/feature.ts"],
          category: "feature",
          order: 0,
          dependencies: [],
        },
      ];

      const messages = MessageWriter.generateMessages(groups, { messages: [] });
      
      expect(messages.length).toBe(1);
      expect(messages[0]?.subject.length).toBeLessThanOrEqual(72);
    });

    test("messages are consistent across groups", () => {
      const groups: CommitGroup[] = [
        {
          id: "group-1",
          name: "Add auth",
          description: "Add authentication",
          hunkIds: ["hunk-1"],
          filePaths: ["src/auth.ts"],
          category: "feature",
          order: 0,
          dependencies: [],
        },
        {
          id: "group-2",
          name: "Add logging",
          description: "Add logging service",
          hunkIds: ["hunk-2"],
          filePaths: ["src/logger.ts"],
          category: "feature",
          order: 1,
          dependencies: [],
        },
      ];

      const messages = MessageWriter.generateMessages(groups, { messages: [] });
      
      expect(messages.length).toBe(2);
      // Both should use feat: prefix
      expect(messages[0]?.subject).toMatch(/^feat: /);
      expect(messages[1]?.subject).toMatch(/^feat: /);
    });

    test("works with single group", () => {
      const groups: CommitGroup[] = [
        {
          id: "group-1",
          name: "Fix bug",
          description: "Fix critical bug",
          hunkIds: ["hunk-1"],
          filePaths: ["src/bug.ts"],
          category: "fix",
          order: 0,
          dependencies: [],
        },
      ];

      const messages = MessageWriter.generateMessages(groups, { messages: [] });
      
      expect(messages.length).toBe(1);
      expect(messages[0]?.subject).toMatch(/^fix: .+/);
    });

    test("works with many groups", () => {
      const groups: CommitGroup[] = Array.from({ length: 10 }, (_, i) => ({
        id: `group-${i}`,
        name: `Feature ${i}`,
        description: `Feature ${i} description`,
        hunkIds: [`hunk-${i}`],
        filePaths: [`src/feature${i}.ts`],
        category: "feature" as const,
        order: i,
        dependencies: [],
      }));

      const messages = MessageWriter.generateMessages(groups, { messages: [] });
      
      expect(messages.length).toBe(10);
      messages.forEach(msg => {
        expect(msg.subject).toMatch(/^feat: .+/);
      });
    });
  });

  describe("get_style_reference", () => {
    test("reads recent commit messages from the repo", async () => {
      // Create some commits
      await writeFile(join(tempDir, "file1.txt"), "content1");
      await $`git add .`.cwd(tempDir);
      await $`git commit -m "feat: add file1"`.cwd(tempDir);
      
      await writeFile(join(tempDir, "file2.txt"), "content2");
      await $`git add .`.cwd(tempDir);
      await $`git commit -m "fix: update file2"`.cwd(tempDir);

      const result = await MessageWriter.getStyleReference(tempDir, 2);
      
      expect(result.messages.length).toBe(2);
      expect(result.messages).toContain("feat: add file1");
      expect(result.messages).toContain("fix: update file2");
    });

    test("returns empty array when no commits", async () => {
      const result = await MessageWriter.getStyleReference(tempDir, 5);
      
      expect(result.messages.length).toBe(0);
    });
  });
});
