import * as p from "@clack/prompts";
import pc from "picocolors";
import { loadConfig, saveConfig, getConfigPath, hasApiKey, ENV_VAR_NAME } from "../lib/config";
import { showTelemetryStatus } from "../lib/telemetry-prompt";
import { telemetry } from "../lib/telemetry";
import { PROVIDER_CONFIG, type ProviderKey } from "../lib/models";
import { selectModelWithSearch } from "./helpers";

export async function handleConfigInit() {
  p.intro(pc.bgCyan(pc.black(" chronicle setup ")));

  const providerOptions = Object.entries(PROVIDER_CONFIG).map(([key, config]) => ({
    value: key,
    label: config.name,
    hint: key === "ollama" ? "No API key required" : undefined,
  }));

  const provider = await p.select({
    message: "Which LLM provider would you like to use?",
    options: providerOptions,
  });

  if (p.isCancel(provider)) {
    p.cancel("Setup cancelled");
    return false;
  }

  const selectedProvider = provider as ProviderKey;
  const providerConfig = PROVIDER_CONFIG[selectedProvider];

  let apiKey: string | undefined;
  let baseUrl: string | undefined;

  if (selectedProvider === "ollama") {
    const baseUrlChoice = await p.text({
      message: "Enter Ollama base URL:",
      placeholder: "http://localhost:11434",
      defaultValue: "http://localhost:11434",
    });

    if (p.isCancel(baseUrlChoice)) {
      p.cancel("Setup cancelled");
      return false;
    }

    baseUrl = baseUrlChoice as string;
  } else {
    const envKey = process.env[ENV_VAR_NAME];

    if (envKey) {
      p.log.success("Found " + ENV_VAR_NAME + " in environment");
      apiKey = envKey;
    } else {
      p.note(
        "Your API key will be stored locally.\nSee: " + getConfigPath(),
        "Security Notice"
      );

      const keyChoice = await p.select({
        message: "How to configure API key?",
        options: [
          { value: "now", label: "Enter API key now" },
          { value: "env", label: "Set " + ENV_VAR_NAME + " env variable" },
          { value: "skip", label: "Skip for now" },
        ],
      });

      if (p.isCancel(keyChoice)) {
        p.cancel("Setup cancelled");
        return false;
      }

      if (keyChoice === "now") {
        const keyInput = await p.password({
          message: "Enter your " + providerConfig.name + " API key:",
        });

        if (p.isCancel(keyInput)) {
          p.cancel("Setup cancelled");
          return false;
        }

        apiKey = keyInput as string;
      } else if (keyChoice === "env") {
        p.note("Set " + ENV_VAR_NAME + " in your shell profile", "Required");
      }
    }
  }

  const model = await selectModelWithSearch(selectedProvider, apiKey, baseUrl);

  if (!model) {
    p.cancel("Setup cancelled");
    return false;
  }

  const configToSave: Parameters<typeof saveConfig>[0] = {
    llm: {
      provider: selectedProvider,
      model,
    },
  };

  if (apiKey) configToSave.llm!.apiKey = apiKey;
  if (baseUrl) configToSave.llm!.baseUrl = baseUrl;

  await saveConfig(configToSave);

  p.outro(pc.green("Setup complete!"));
  return true;
}

export async function handleConfigShow() {
  const config = await loadConfig();
  const provider = config.llm.provider as ProviderKey;
  const providerConfig = PROVIDER_CONFIG[provider];

  console.log(pc.bold("\n⚙️  chronicle Configuration\n"));
  console.log(pc.dim("Config: " + getConfigPath() + "\n"));
  console.log(pc.cyan("LLM Provider:"));
  console.log("  Provider: " + (providerConfig?.name ?? provider));
  console.log("  Model: " + (config.llm.model ?? providerConfig?.defaultModel ?? "default"));

  const hasKey = await hasApiKey();
  if (hasKey) {
    console.log("  API Key: " + pc.green("✓ Set"));
  } else {
    console.log("  API Key: " + pc.red("✗ Not configured"));
  }

  if (config.llm.customPrompt) {
    console.log("  Custom Prompt: " + pc.green("✓ Configured"));
  }
}

export async function handleConfigPrompt(input?: { clear?: boolean; prompt?: string }) {
  const config = await loadConfig();

  if (input?.clear) {
    await saveConfig({ llm: { ...config.llm, customPrompt: undefined } });
    console.log(pc.green("\n✅ Custom prompt cleared\n"));
    return;
  }

  if (input?.prompt) {
    await saveConfig({ llm: { ...config.llm, customPrompt: input.prompt } });
    console.log(pc.green("\n✅ Custom prompt set: " + input.prompt + "\n"));
    return;
  }

  p.intro(pc.bgCyan(pc.black(" custom AI instructions ")));

  if (config.llm.customPrompt) {
    console.log(pc.dim("Current prompt:"));
    console.log(pc.cyan("  " + config.llm.customPrompt + "\n"));
  } else {
    console.log(pc.dim("No custom prompt configured.\n"));
  }

  const action = await p.select({
    message: "What would you like to do?",
    options: [
      ...(config.llm.customPrompt
        ? [
            { value: "edit", label: "Edit prompt" },
            { value: "set", label: "Set new prompt" },
            { value: "clear", label: "Clear prompt" },
          ]
        : [{ value: "set", label: "Set new prompt" }]),
      { value: "cancel", label: "Cancel" },
    ],
  });

  if (p.isCancel(action) || action === "cancel") {
    p.cancel("Cancelled");
    process.exit(0);
  }

  if (action === "clear") {
    await saveConfig({ llm: { ...config.llm, customPrompt: undefined } });
    p.outro(pc.green("✅ Custom prompt cleared"));
    return;
  }

  const promptInput = await p.text({
    message: action === "edit" ? "Edit your custom instructions:" : "Enter custom instructions:",
    placeholder: "e.g., Use lowercase commit messages with emoji prefixes",
    defaultValue: config.llm.customPrompt ?? "",
  });

  if (p.isCancel(promptInput)) {
    p.cancel("Cancelled");
    process.exit(0);
  }

  const newPrompt = (promptInput as string).trim();

  if (newPrompt) {
    await saveConfig({ llm: { ...config.llm, customPrompt: newPrompt } });
    p.outro(pc.green("✅ Custom prompt saved"));
  } else {
    await saveConfig({ llm: { ...config.llm, customPrompt: undefined } });
    p.outro(pc.green("✅ Custom prompt cleared"));
  }
}

export async function handleConfigTelemetry(input?: { optOut?: boolean; optIn?: boolean }) {
  const envVarName = "CHRONICLE_TELEMETRY";
  const envDisabled =
    process.env[envVarName]?.toLowerCase() === "false" || process.env[envVarName] === "0";

  if (envDisabled) {
    p.log.warn(pc.yellow("\n⚠️  Telemetry is disabled via " + envVarName + "=false.\n"));
    return;
  }

  if (input?.optOut) {
    await telemetry.optOut();
    console.log(pc.yellow("\n✅ Telemetry opted-out\n"));
    return;
  }

  if (input?.optIn) {
    await telemetry.optIn();
    console.log(pc.green("\n✅ Telemetry opted-in\n"));
    return;
  }

  await showTelemetryStatus();
}
