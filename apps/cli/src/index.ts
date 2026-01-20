#!/usr/bin/env bun
import { createCli } from "trpc-cli";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { router } from "./commands/router";
import { telemetry } from "./lib/telemetry";
import { showTelemetryNotice } from "./lib/telemetry-prompt";

const cli = createCli({
  router,
  name: "chronicle",
  description: "AI-powered CLI that transforms uncommitted changes into a realistic git commit history",
  version: "0.1.0",
});

type MainAction = "analyze" | "backfill" | "status" | "config" | "exit";
type ConfigAction = "model" | "provider" | "show" | "init" | "prompt" | "telemetry" | "back";

/**
 * Handle the config prompt command interactively
 * Returns true if user wants to go back to main menu, false to exit
 */
async function handleConfigPromptInteractive(): Promise<boolean> {
  const config = await import("./lib/config.js").then((m) => m.loadConfig());
  const saveConfig = await import("./lib/config.js").then((m) => m.saveConfig);

  p.intro(pc.bgCyan(pc.black(" custom AI instructions ")));

  const displayCurrentPrompt = () => {
    if (config.llm.customPrompt) {
      console.log(pc.dim("Current prompt:"));
      console.log(pc.cyan(`  ${config.llm.customPrompt}\n`));
    } else {
      console.log(pc.dim("No custom prompt configured.\n"));
    }
  };

  displayCurrentPrompt();

  const action = await p.select({
    message: "What would you like to do?",
    options: [
      ...(config.llm.customPrompt
        ? [
            { value: "edit", label: "Edit prompt", hint: "Modify existing custom instructions" },
            { value: "set", label: "Set new prompt", hint: "Replace with new custom instructions" },
            { value: "clear", label: "Clear prompt", hint: "Remove custom instructions" },
          ]
        : [{ value: "set", label: "Set new prompt", hint: "Add custom instructions for AI" }]),
      { value: "cancel", label: "Cancel" },
    ],
  });

  if (p.isCancel(action) || action === "cancel") {
    return true; // Go back to menu
  }

  if (action === "clear") {
    await saveConfig({
      llm: {
        ...config.llm,
        customPrompt: undefined,
      },
    });
    p.outro(pc.green("✅ Custom prompt cleared"));

    const nextAction = await p.select({
      message: "What would you like to do?",
      options: [
        { value: "menu", label: "Back to main menu", hint: "Return to chronicle menu" },
        { value: "exit", label: "Exit", hint: "Quit chronicle" },
      ],
    });

    return !p.isCancel(nextAction) && nextAction === "menu";
  }

  p.note(
    "Custom instructions are appended to all AI prompts.\n" +
      "Use this to customize commit message style, language, etc.\n\n" +
      pc.dim("Examples:\n") +
      pc.dim('  • "Always use lowercase commit messages"\n') +
      pc.dim('  • "Write commit messages in Spanish"\n') +
      pc.dim('  • "Use emoji prefixes: feat: ✨, fix: 🐛, docs: 📚"'),
    "Tips",
  );

  const promptInput = await p.text({
    message: action === "edit" ? "Edit your custom instructions:" : "Enter your custom instructions:",
    placeholder: "e.g., Use lowercase commit messages with emoji prefixes",
    defaultValue: config.llm.customPrompt ?? "",
  });

  if (p.isCancel(promptInput)) {
    return true; // Go back to menu
  }

  const newPrompt = (promptInput as string).trim();

  if (newPrompt) {
    await saveConfig({
      llm: {
        ...config.llm,
        customPrompt: newPrompt,
      },
    });
    p.outro(pc.green("✅ Custom prompt saved"));
  } else {
    await saveConfig({
      llm: {
        ...config.llm,
        customPrompt: undefined,
      },
    });
    p.outro(pc.green("✅ Custom prompt cleared"));
  }

  const nextAction = await p.select({
    message: "What would you like to do?",
    options: [
      { value: "menu", label: "Back to main menu", hint: "Return to chronicle menu" },
      { value: "exit", label: "Exit", hint: "Quit chronicle" },
    ],
  });

  return !p.isCancel(nextAction) && nextAction === "menu";
}

/**
 * Show the main menu
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
 * Main interactive loop
 */
async function interactiveLoop(): Promise<string | null> {
  p.intro(pc.bgCyan(pc.black(" chronicle ")));

  while (true) {
    const action = await showMainMenu();

    if (action === null || action === "exit") {
      exitCli();
    }

    if (action === "config") {
      // Enter config submenu
      const configAction = await showConfigMenu();

      if (configAction === null) {
        exitCli();
      }

      if (configAction === "back") {
        // Go back to main menu
        continue;
      }

      // Handle prompt command interactively to allow returning to menu
      if (configAction === "prompt") {
        const goBackToMenu = await handleConfigPromptInteractive();
        if (goBackToMenu) {
          // Show a divider and go back to main menu
          console.log();
          continue;
        }
        // User chose to exit
        exitCli();
      }

      // Return the config command to execute
      return `config ${configAction}`;
    }

    // Return the selected command
    return action;
  }
}

async function main() {
  // Initialize telemetry (opt-out by default)
  await telemetry.init();

  // Show telemetry notice only on first run (or during config init)
  await showTelemetryNotice();

  // Check if any command was passed (skip node/bun and script path)
  const args = process.argv.slice(2);

  if (args.length === 0) {
    // No command provided - show interactive prompt
    const command = await interactiveLoop();

    if (command) {
      // Add the command to argv for trpc-cli to handle
      const commandParts = command.split(" ");
      process.argv.push(...commandParts);
    }
  }

  // Run the CLI with the (possibly modified) arguments
  await cli.run();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
