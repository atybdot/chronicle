#!/usr/bin/env bun
import { createCli } from "trpc-cli";
import * as p from "@clack/prompts";
import pc from "picocolors";
import packageJson from "../package.json";
import { router } from "./commands/router";
import { telemetry } from "./lib/telemetry";
import { showTelemetryNotice } from "./lib/telemetry-prompt";

const cli = createCli({
  router,
  name: "chronicle",
  description: "AI-powered CLI that transforms uncommitted changes into a realistic git commit history",
  version: packageJson.version,
});

type MainAction = "analyze" | "backfill" | "status" | "config" | "exit";
type ConfigAction = "model" | "provider" | "show" | "init" | "prompt" | "telemetry" | "cache-clear" | "back";

/**
 * Show the main menu and get action
 * Returns the selected action or null if cancelled
 */
async function showMainMenu(): Promise<MainAction | null> {
  const action = await p.select({
    message: "What would you like to do?",
    options: [
      {
        value: "analyze",
        label: "Analyze uncommitted changes",
        hint: "See how your changes would be split into commits",
      },
      {
        value: "backfill",
        label: "Backfill commit history",
        hint: "Generate and execute a commit plan",
      },
      {
        value: "status",
        label: "Show repository status",
        hint: "View current uncommitted changes",
      },
      {
        value: "config",
        label: "Configuration",
        hint: "Manage settings and setup",
      },
      {
        value: "exit",
        label: "Exit",
        hint: "Quit chronicle",
      },
    ],
  });

  if (p.isCancel(action)) {
    return null;
  }

  return action as MainAction;
}

/**
 * Show the config submenu
 * Returns the selected config action or null if cancelled
 */
async function showConfigMenu(): Promise<ConfigAction | null> {
  const action = await p.select({
    message: "Configuration options:",
    options: [
      { value: "model", label: "Change model", hint: "Switch to a different LLM model" },
      { value: "provider", label: "Change provider", hint: "Switch to a different LLM provider" },
      { value: "prompt", label: "Modify AI prompt", hint: "Customize commit message style" },
      { value: "cache-clear", label: "Clear all caches", hint: "Purge analyze, backfill, model, and other caches" },
      { value: "show", label: "Show current config", hint: "View your current settings" },
      { value: "init", label: "Full setup wizard", hint: "Configure provider, model, and API key" },
      { value: "telemetry", label: "Telemetry settings", hint: "Manage anonymous usage data" },
      { value: "back", label: "← Back", hint: "Return to main menu" },
    ],
  });

  if (p.isCancel(action)) {
    return null;
  }

  return action as ConfigAction;
}

/**
 * Exit the CLI gracefully
 */
function exitCli(message = "Goodbye!"): never {
  p.outro(pc.dim(message));
  process.exit(0);
}

/**
 * Run the interactive menu loop
 * Returns a command string to execute, or null to exit
 */
async function runInteractiveMenu(): Promise<string | null> {
  while (true) {
    const action = await showMainMenu();

    if (action === null || action === "exit") {
      return null;
    }

    if (action === "config") {
      const configAction = await showConfigMenu();

      if (configAction === null) {
        return null;
      }

      if (configAction === "back") {
        continue;
      }

      return `config ${configAction}`;
    }

    return action;
  }
}

async function main() {
  const telemetryPromise = telemetry.init();
  const noticePromise = showTelemetryNotice();

  const args = process.argv.slice(2);

  if (args.length > 0) {
    await Promise.all([telemetryPromise, noticePromise]);
    await cli.run();
    return;
  }

  await Promise.all([telemetryPromise, noticePromise]);

  p.intro(pc.bgCyan(pc.black(" chronicle ")));

  while (true) {
    const command = await runInteractiveMenu();

    if (!command) {
      exitCli();
    }

    process.argv = [process.argv[0]!, process.argv[1]!, ...command.split(" ")];
    await cli.run();
    console.log();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
