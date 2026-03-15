import * as p from "@clack/prompts";
import pc from "picocolors";
import type { LLMProviderConfig } from "../types";
import {
  loadConfig,
  saveConfig,
  getConfigPath,
  hasApiKey,
  getCloudflareConfig,
  ENV_VAR_NAME,
  findProviderConfig,
  getSelectedModel,
  getSelectedProvider,
  upsertProviderConfig,
} from "../lib/config";
import { clearCache } from "../lib/cache";
import { showTelemetryStatus } from "../lib/telemetry-prompt";
import { telemetry, categorizeModel } from "../lib/telemetry";
import { PROVIDER_CONFIG, type ProviderKey } from "../lib/models";
import { selectModelWithSearch } from "./helpers";

function getProviderHint(key: string): string | undefined {
  if (key === "ollama") return "No API key required";
  if (key === "cloudflare") return "Multi-provider gateway";
  if (key === "opencode-zen") return "Curated coding models";
  return undefined;
}

function getProviderOptions() {
  return Object.entries(PROVIDER_CONFIG).map(([key, config]) => ({
    value: key,
    label: config.name,
    hint: getProviderHint(key),
  }));
}

function saveProviderSelection(
  providers: LLMProviderConfig[],
  providerConfig: LLMProviderConfig,
  model: string,
) {
  const nextProviderConfig = upsertProviderConfig(providers, {
    ...providerConfig,
    model,
  });

  return saveConfig({
    llm: {
      selected: {
        provider: providerConfig.name,
        model,
      },
      providers: nextProviderConfig,
    },
  });
}

async function configureProvider(
  selectedProvider: ProviderKey,
  existingProviderConfig?: LLMProviderConfig,
): Promise<{ providerConfig: LLMProviderConfig; model: string } | null> {
  const providerConfig = PROVIDER_CONFIG[selectedProvider];

  let apiKey = existingProviderConfig?.API_TOKEN;
  let baseUrl = existingProviderConfig?.baseUrl;
  let accountId = existingProviderConfig?.accountId;
  let gatewayId = existingProviderConfig?.gatewayId;
  let usingSavedConfig = false;

  if (selectedProvider === "ollama") {
    const baseUrlChoice = await p.text({
      message: "Enter Ollama base URL:",
      placeholder: "http://localhost:11434",
      defaultValue: existingProviderConfig?.baseUrl ?? "http://localhost:11434",
    });

    if (p.isCancel(baseUrlChoice)) {
      p.cancel("Cancelled");
      return null;
    }

    baseUrl = baseUrlChoice as string;
  } else if (selectedProvider === "cloudflare") {
    const hasEnvConfig =
      process.env.CF_ACCOUNT_ID && process.env.CF_GATEWAY_ID && process.env.CF_API_TOKEN;

    if (hasEnvConfig) {
      p.log.success("Found Cloudflare config in environment variables");
    } else if (existingProviderConfig?.API_TOKEN && existingProviderConfig.accountId && existingProviderConfig.gatewayId) {
      usingSavedConfig = true;
      p.log.success("Using saved Cloudflare configuration");
    } else {
      p.note(
        "Cloudflare AI Gateway requires:\n" +
          "  • Account ID (from Dashboard Overview)\n" +
          "  • Gateway ID (your gateway name)\n" +
          "  • API Token (with AI Gateway permissions)",
        "Required Values"
      );

      const accountIdInput = await p.text({
        message: "Enter Cloudflare Account ID:",
        placeholder: "abc123def456...",
        defaultValue: existingProviderConfig?.accountId ?? "",
      });
      if (p.isCancel(accountIdInput)) {
        p.cancel("Cancelled");
        return null;
      }
      accountId = accountIdInput as string;

      const gatewayIdInput = await p.text({
        message: "Enter Gateway ID:",
        placeholder: "my-gateway",
        defaultValue: existingProviderConfig?.gatewayId ?? "",
      });
      if (p.isCancel(gatewayIdInput)) {
        p.cancel("Cancelled");
        return null;
      }
      gatewayId = gatewayIdInput as string;

      const apiTokenInput = await p.password({
        message: "Enter Cloudflare API Token:",
      });
      if (p.isCancel(apiTokenInput)) {
        p.cancel("Cancelled");
        return null;
      }
      apiKey = apiTokenInput as string;
    }
  } else {
    const envKey = process.env[ENV_VAR_NAME];

    if (envKey) {
      p.log.success("Found " + ENV_VAR_NAME + " in environment");
      apiKey = envKey;
    } else if (existingProviderConfig?.API_TOKEN) {
      usingSavedConfig = true;
      p.log.success("Using saved " + providerConfig.name + " API key");
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

      if (p.isCancel(keyChoice) || keyChoice === "skip") {
        p.cancel("Setup cancelled");
        return null;
      }

      if (keyChoice === "now") {
        const keyInput = await p.password({
          message: "Enter your " + providerConfig.name + " API key:",
        });

        if (p.isCancel(keyInput)) {
          p.cancel("Setup cancelled");
          return null;
        }

        apiKey = keyInput as string;
      } else {
        p.note("Set " + ENV_VAR_NAME + " in your shell profile", "Required");
      }
    }
  }

  const model = await selectModelWithSearch(selectedProvider, apiKey, baseUrl);
  if (!model) {
    p.cancel("Cancelled");
    return null;
  }

  if (usingSavedConfig) {
    p.log.success("Reused saved provider configuration");
  }

  return {
    providerConfig: {
      name: selectedProvider,
      API_TOKEN: apiKey,
      model,
      baseUrl,
      accountId,
      gatewayId,
    },
    model,
  };
}

export async function handleConfigInit() {
  telemetry.track({
    event: "command_invoked",
    properties: {
      command: "config",
      subcommand: "init",
      success: true,
    },
  });

  p.intro(pc.bgCyan(pc.black(" chronicle setup ")));

  const config = await loadConfig();
  const provider = await p.select({
    message: "Which LLM provider would you like to use?",
    options: getProviderOptions(),
  });

  if (p.isCancel(provider)) {
    p.cancel("Setup cancelled");
    return false;
  }

  const selectedProvider = provider as ProviderKey;
  const configured = await configureProvider(selectedProvider, findProviderConfig(config, selectedProvider));
  if (!configured) {
    return false;
  }

  await saveProviderSelection(config.llm.providers, configured.providerConfig, configured.model);

  telemetry.track({
    event: "setup_completed",
    properties: {
      provider: selectedProvider,
      model_category: categorizeModel(configured.model),
      api_key_source: configured.providerConfig.API_TOKEN
        ? "entered"
        : process.env[ENV_VAR_NAME]
          ? "environment"
          : "skipped",
    },
  });

  p.outro(pc.green("Setup complete!"));
  return true;
}

export async function handleConfigShow() {
  telemetry.track({
    event: "command_invoked",
    properties: {
      command: "config",
      subcommand: "show",
      success: true,
    },
  });

  const config = await loadConfig();
  const provider = getSelectedProvider(config) as ProviderKey;
  const providerConfig = PROVIDER_CONFIG[provider];
  const selectedProviderConfig = findProviderConfig(config, provider);

  console.log(pc.bold("\n⚙️  chronicle Configuration\n"));
  console.log(pc.dim("Config: " + getConfigPath() + "\n"));
  console.log(pc.cyan("LLM Provider:"));
  console.log("  Provider: " + (providerConfig?.name ?? provider));
  console.log("  Model: " + (getSelectedModel(config) ?? providerConfig?.defaultModel ?? "default"));

  if (provider === "cloudflare") {
    const cfConfig = await getCloudflareConfig();
    console.log("  Account ID: " + (cfConfig.accountId ? pc.green("✓ Set") : pc.red("✗ Not set")));
    console.log("  Gateway ID: " + (cfConfig.gatewayId ? pc.green("✓ Set") : pc.red("✗ Not set")));
    console.log("  API Token: " + (cfConfig.apiToken ? pc.green("✓ Set") : pc.red("✗ Not set")));
  } else {
    const hasKey = await hasApiKey(provider);
    console.log("  API Key: " + (hasKey ? pc.green("✓ Set") : pc.red("✗ Not configured")));
  }

  console.log("  Saved Provider Config: " + (selectedProviderConfig ? pc.green("✓ Present") : pc.red("✗ None")));

  if (config.llm.providers.length > 0) {
    console.log(pc.cyan("\nConfigured providers:"));
    for (const entry of config.llm.providers) {
      const label = PROVIDER_CONFIG[entry.name]?.name ?? entry.name;
      const current = entry.name === provider ? " (selected)" : "";
      console.log("  - " + label + current);
    }
  }

  if (config.llm.customPrompt) {
    console.log("\n  Custom Prompt: " + pc.green("✓ Configured"));
  }
}

export async function handleConfigPrompt(input?: { clear?: boolean; prompt?: string }) {
  telemetry.track({
    event: "command_invoked",
    properties: {
      command: "config",
      subcommand: "prompt",
      success: true,
    },
  });

  const config = await loadConfig();

  if (input?.clear) {
    await saveConfig({ llm: { ...config.llm, customPrompt: undefined } });
    telemetry.track({ event: "config_changed", properties: { key: "customPrompt" } });
    console.log(pc.green("\n✅ Custom prompt cleared\n"));
    return;
  }

  if (input?.prompt) {
    await saveConfig({ llm: { ...config.llm, customPrompt: input.prompt } });
    telemetry.track({ event: "config_changed", properties: { key: "customPrompt" } });
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

  telemetry.track({ event: "config_changed", properties: { key: "customPrompt" } });

  if (newPrompt) {
    await saveConfig({ llm: { ...config.llm, customPrompt: newPrompt } });
    p.outro(pc.green("✅ Custom prompt saved"));
  } else {
    await saveConfig({ llm: { ...config.llm, customPrompt: undefined } });
    p.outro(pc.green("✅ Custom prompt cleared"));
  }
}

export async function handleConfigTelemetry(input?: { optOut?: boolean; optIn?: boolean }) {
  telemetry.track({
    event: "command_invoked",
    properties: {
      command: "config",
      subcommand: "telemetry",
      success: true,
    },
  });

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

export async function handleConfigCacheClear() {
  telemetry.track({
    event: "command_invoked",
    properties: {
      command: "config",
      subcommand: "cache-clear",
      success: true,
    },
  });

  await clearCache();
  p.outro(pc.green("✅ Cleared all Chronicle caches"));
}

export async function handleConfigModel() {
  telemetry.track({
    event: "command_invoked",
    properties: {
      command: "config",
      subcommand: "model",
      success: true,
    },
  });

  p.intro(pc.bgCyan(pc.black(" change model ")));

  const config = await loadConfig();
  const currentProvider = getSelectedProvider(config) as ProviderKey;
  const currentProviderConfig = findProviderConfig(config, currentProvider);
  const model = await selectModelWithSearch(
    currentProvider,
    currentProviderConfig?.API_TOKEN,
    currentProviderConfig?.baseUrl
  );

  if (!model) {
    p.cancel("Cancelled");
    return;
  }

  await saveProviderSelection(config.llm.providers, {
    name: currentProvider,
    API_TOKEN: currentProviderConfig?.API_TOKEN,
    baseUrl: currentProviderConfig?.baseUrl,
    accountId: currentProviderConfig?.accountId,
    gatewayId: currentProviderConfig?.gatewayId,
  }, model);

  telemetry.track({ event: "config_changed", properties: { key: "model" } });
  p.outro(pc.green("✅ Model changed to: " + model + " (AI response cache cleared)"));
}

export async function handleConfigProvider() {
  telemetry.track({
    event: "command_invoked",
    properties: {
      command: "config",
      subcommand: "provider",
      success: true,
    },
  });

  p.intro(pc.bgCyan(pc.black(" change provider ")));

  const config = await loadConfig();
  const provider = await p.select({
    message: "Which LLM provider would you like to use?",
    options: getProviderOptions(),
    initialValue: getSelectedProvider(config),
  });

  if (p.isCancel(provider)) {
    p.cancel("Cancelled");
    return;
  }

  const selectedProvider = provider as ProviderKey;
  const existingProviderConfig = findProviderConfig(config, selectedProvider);

  if (existingProviderConfig) {
    const model = existingProviderConfig.model ?? PROVIDER_CONFIG[selectedProvider].defaultModel;
    await saveProviderSelection(config.llm.providers, existingProviderConfig, model);
    telemetry.track({ event: "config_changed", properties: { key: "provider" } });
    p.outro(pc.green("✅ Provider changed to: " + PROVIDER_CONFIG[selectedProvider].name + " (AI response cache cleared)"));
    return;
  }

  const configured = await configureProvider(selectedProvider, existingProviderConfig);
  if (!configured) {
    return;
  }

  await saveProviderSelection(config.llm.providers, configured.providerConfig, configured.model);
  telemetry.track({ event: "config_changed", properties: { key: "provider" } });
  p.outro(pc.green("✅ Provider changed to: " + PROVIDER_CONFIG[selectedProvider].name + " (AI response cache cleared)"));
}
