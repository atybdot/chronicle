import { z } from "zod";
import type { CommitGroup, CommitMessage } from "../../types";
import { CATEGORY_PREFIXES } from "../../types";
import { $ } from "bun";

type MessageStyle = "conventional" | "descriptive" | "terse";

type StyleReference = {
  messages: string[];
};

function generateConventionalMessage(group: CommitGroup): string {
  const prefix = CATEGORY_PREFIXES[group.category];
  const name = group.name.toLowerCase();
  return `${prefix}: ${name}`;
}

function generateDescriptiveMessage(group: CommitGroup): string {
  return group.name;
}

function generateTerseMessage(group: CommitGroup): string {
  // Extract key words from the name
  const words = group.name.split(" ").slice(0, 2);
  return words.join(" ").toLowerCase();
}

function truncateSubject(subject: string, maxLength: number = 72): string {
  if (subject.length <= maxLength) return subject;
  return subject.slice(0, maxLength - 3) + "...";
}

function generateBody(group: CommitGroup): string | undefined {
  // Add body for complex changes
  if (group.filePaths.length > 3 || group.hunkIds.length > 5) {
    const fileList = group.filePaths.slice(0, 3).join(", ");
    const more = group.filePaths.length > 3 
      ? ` and ${group.filePaths.length - 3} more files`
      : "";
    return `Changes in ${fileList}${more}`;
  }
  return undefined;
}

export const MessageWriter = {
  generateMessages(groups: CommitGroup[], styleReference: StyleReference): CommitMessage[] {
    // Determine style from reference messages
    let style: MessageStyle = "conventional";
    if (styleReference.messages.length > 0) {
      const firstMsg = styleReference.messages[0] ?? "";
      if (firstMsg.match(/^[a-z]+: /)) {
        style = "conventional";
      } else if (firstMsg.length < 20) {
        style = "terse";
      } else {
        style = "descriptive";
      }
    }
    
    return groups.map(group => {
      let subject: string;
      
      switch (style) {
        case "conventional":
          subject = generateConventionalMessage(group);
          break;
        case "descriptive":
          subject = generateDescriptiveMessage(group);
          break;
        case "terse":
          subject = generateTerseMessage(group);
          break;
        default:
          subject = generateConventionalMessage(group);
      }
      
      subject = truncateSubject(subject);
      const body = generateBody(group);
      
      return {
        groupId: group.id,
        subject,
        ...(body ? { body } : {}),
      };
    });
  },
  
  async getStyleReference(repoRoot: string, count: number): Promise<StyleReference> {
    try {
      // Use git log to get recent commit messages from specified repo
      const result = await $`git log --oneline -${count}`.cwd(repoRoot).text();
      const lines = result.trim().split("\n").filter(Boolean);
      
      // Extract commit messages (remove hash prefix)
      const messages = lines.map(line => {
        const parts = line.split(" ");
        parts.shift(); // Remove hash
        return parts.join(" ");
      });
      
      return { messages };
    } catch {
      return { messages: [] };
    }
  },
};
