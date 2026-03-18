import { homedir } from "os";
import { dirname, join } from "path";
import { Result } from "better-result";
import type { Config, LLMProvider, LLMProviderConfig } from "../types";
import { ConfigError } from "./errors";
import { clearCache, CacheNamespaces } from "./cache";

type ConfigUpdate = {
  [K in keyof Config]?: Config[K] extends Array<infer U>
    ? U[]
    : Config[K] extends Record<string, unknown>
      ? { [P in keyof Config[K]]?: Config[K][P] }
      : Config[K];
};

const DEFAULT_CONFIG_DIR = join(homedir(), ".config", "chronicle");
const LEGACY_CONFIG_DIR = join(homedir(), ".chronicle");

function expandHomePath(pathValue: string): string {
  if (pathValue === "~") {
    return homedir();
  }

  if (pathValue.startsWith("~/")) {
    return join(homedir(), pathValue.slice(2));
  }

  return pathValue;
}

function getPreferredConfigDir(): string {
  const configuredPath = process.env.CHRONICLE_CONFIG_DIR;
  if (!configuredPath) {
    return DEFAULT_CONFIG_DIR;
  }

  const expandedPath = expandHomePath(configuredPath);
  return expandedPath.endsWith(".json") ? dirname(expandedPath) : expandedPath;
}

function getConfigFile(dir: string): string {
  return join(dir, "config.json");
}

function getPreferredConfigFile(): string {
  const configuredPath = process.env.CHRONICLE_CONFIG_DIR;
  if (!configuredPath) {
    return getConfigFile(getPreferredConfigDir());
  }

  const expandedPath = expandHomePath(configuredPath);
  return expandedPath.endsWith(".json") ? expandedPath : getConfigFile(expandedPath);
}

function getLegacyConfigFile(): string {
  return getConfigFile(LEGACY_CONFIG_DIR);
}

const DEFAULT_CONFIG: Config = {
  llm: {
    selected: {
      provider: "openrouter",
      model: undefined,
    },
    providers: [],
    customPrompt: undefined,
  },
  git: {
    authorName: undefined,
    authorEmail: undefined,
  },
  defaults: {
    distribution: "realistic",
    dryRun: true,
    workHoursStart: 9,
    workHoursEnd: 18,
    excludeWeekends: false,
  },
};

/**
 * Ensure config directory exists
 */
async function ensureConfigDir(): Promise<void> {
  try {
    await Bun.write(join(getPreferredConfigDir(), ".keep"), "");
  } catch {
    // Directory might already exist, that's fine
  }
}

async function readExistingConfigFile(): Promise<{ path: string; content: unknown } | null> {
  const xdgConfigDir = process.env.XDG_CONFIG_HOME
    ? join(expandHomePath(process.env.XDG_CONFIG_HOME), "chronicle")
    : null;
  const candidates = [
    getPreferredConfigFile(),
    xdgConfigDir ? getConfigFile(xdgConfigDir) : null,
    getConfigFile(DEFAULT_CONFIG_DIR),
    getLegacyConfigFile(),
  ].filter((value): value is string => Boolean(value));

  for (const configFile of candidates) {
    try {
      const file = Bun.file(configFile);
      if (await file.exists()) {
        return { path: configFile, content: await file.json() };
      }
    } catch {
      // Try the next location
    }
  }

  return null;
}

/**
 * Load configuration from file
 */
export async function loadConfig(): Promise<Config> {
  try {
    const existing = await readExistingConfigFile();
    if (existing) {
      const content = existing.content;
      const normalizedConfig = normalizeConfig(deepMerge(DEFAULT_CONFIG, content as Partial<Config>));
      if (hasLegacyLlmConfig(content)) {
        await persistMigratedConfig(normalizedConfig);
      } else if (existing.path !== getPreferredConfigFile()) {
        await persistMigratedConfig(normalizedConfig);
      }
      return normalizedConfig;
    }
  } catch {
    // Config doesn't exist or is invalid
  }
  return DEFAULT_CONFIG;
}

/**
 * Load configuration with Result type
 */
export async function loadConfigSafe(): Promise<Result<Config, ConfigError>> {
  return Result.tryPromise({
    try: async () => {
      const existing = await readExistingConfigFile();
      if (existing) {
        const content = existing.content;
        const normalizedConfig = normalizeConfig(deepMerge(DEFAULT_CONFIG, content as Partial<Config>));
        if (hasLegacyLlmConfig(content)) {
          await persistMigratedConfig(normalizedConfig);
        } else if (existing.path !== getPreferredConfigFile()) {
          await persistMigratedConfig(normalizedConfig);
        }
        return normalizedConfig;
      }
      return DEFAULT_CONFIG;
    },
    catch: (e) =>
      new ConfigError({
        path: getPreferredConfigFile(),
        message: `Failed to load config: ${e instanceof Error ? e.message : String(e)}`,
      }),
  });
}

/**
 * Save configuration to file
 */
export async function saveConfig(config: ConfigUpdate): Promise<void> {
  await ensureConfigDir();
  const currentConfig = await loadConfig();
  const newConfig = normalizeConfig(deepMerge(currentConfig, config));
  await Bun.write(getPreferredConfigFile(), JSON.stringify(newConfig, null, 2));

  if (didSelectedLlmChange(currentConfig, newConfig)) {
    await clearCache(CacheNamespaces.AI_RESPONSES);
  }
}

/**
 * Save configuration with Result type
 */
export async function saveConfigSafe(config: ConfigUpdate): Promise<Result<void, ConfigError>> {
  return Result.tryPromise({
    try: async () => {
      await ensureConfigDir();
      const currentConfig = await loadConfig();
      const newConfig = normalizeConfig(deepMerge(currentConfig, config));
      await Bun.write(getPreferredConfigFile(), JSON.stringify(newConfig, null, 2));

      if (didSelectedLlmChange(currentConfig, newConfig)) {
        await clearCache(CacheNamespaces.AI_RESPONSES);
      }
    },
      catch: (e) =>
        new ConfigError({
          path: getPreferredConfigFile(),
          message: `Failed to save config: ${e instanceof Error ? e.message : String(e)}`,
        }),
  });
}

/**
 * Get a specific config value
 */
export async function getConfigValue<K extends keyof Config>(key: K): Promise<Config[K]> {
  const config = await loadConfig();
  return config[key];
}

/**
 * Set a specific config value
 */
export async function setConfigValue<K extends keyof Config>(
  key: K,
  value: Config[K],
): Promise<void> {
  const config = await loadConfig();
  config[key] = value;
  await saveConfig(config);
}

/**
 * The unified environment variable for API keys
 */
export const ENV_VAR_NAME = "CHRONICLE_AI_KEY";

/**
 * Get API key for LLM provider (checks env var first, then config)
 */
export async function getApiKey(provider?: LLMProvider): Promise<string | undefined> {
  const config = await loadConfig();
  const providerConfig = provider
    ? findProviderConfig(config, provider)
    : getSelectedProviderConfig(config);
  return providerConfig?.API_TOKEN ?? process.env[ENV_VAR_NAME];
}

/**
 * Check if API key is configured (either in env or config)
 */
export async function hasApiKey(provider?: LLMProvider): Promise<boolean> {
  const key = await getApiKey(provider);
  return !!key;
}

export async function getCloudflareConfig(): Promise<{
  accountId?: string;
  gatewayId?: string;
  apiToken?: string;
}> {
  const config = await loadConfig();
  const providerConfig = findProviderConfig(config, "cloudflare");
  return {
    accountId: process.env.CF_ACCOUNT_ID ?? providerConfig?.accountId,
    gatewayId: process.env.CF_GATEWAY_ID ?? providerConfig?.gatewayId,
    apiToken: process.env.CF_API_TOKEN ?? providerConfig?.API_TOKEN,
  };
}

export async function hasCloudflareConfig(): Promise<boolean> {
  const { accountId, gatewayId, apiToken } = await getCloudflareConfig();
  return !!(accountId && gatewayId && apiToken);
}

/**
 * Get custom prompt for AI calls
 */
export async function getCustomPrompt(): Promise<string | undefined> {
  const config = await loadConfig();
  return config.llm.customPrompt;
}

export function findProviderConfig(config: Config, provider: LLMProvider): LLMProviderConfig | undefined {
  return config.llm.providers.find((entry) => entry.name === provider);
}

export function getSelectedProvider(config: Config): LLMProvider {
  return config.llm.selected.provider;
}

export function getSelectedModel(config: Config): string | undefined {
  return config.llm.selected.model ?? getSelectedProviderConfig(config)?.model;
}

export function getSelectedProviderConfig(config: Config): LLMProviderConfig | undefined {
  return findProviderConfig(config, getSelectedProvider(config));
}

export function upsertProviderConfig(
  providers: LLMProviderConfig[],
  providerConfig: LLMProviderConfig,
): LLMProviderConfig[] {
  const existingIndex = providers.findIndex((entry) => entry.name === providerConfig.name);
  if (existingIndex === -1) {
    return [...providers, providerConfig];
  }

  return providers.map((entry, index) => (index === existingIndex ? { ...entry, ...providerConfig } : entry));
}

function didSelectedLlmChange(previousConfig: Config, nextConfig: Config): boolean {
  return (
    getSelectedProvider(previousConfig) !== getSelectedProvider(nextConfig) ||
    getSelectedModel(previousConfig) !== getSelectedModel(nextConfig)
  );
}

/**
 * Deep merge two objects
 */
function deepMerge<T extends Record<string, unknown>>(target: T, source: unknown): T {
  const result: Record<string, unknown> = { ...target };
  const sourceObject = (source ?? {}) as Record<string, unknown>;

  for (const key in sourceObject) {
    if (sourceObject[key] !== undefined) {
      if (
        typeof sourceObject[key] === "object" &&
        sourceObject[key] !== null &&
        !Array.isArray(sourceObject[key])
      ) {
        result[key] = deepMerge(
          (target[key] ?? {}) as Record<string, unknown>,
          sourceObject[key] as Record<string, unknown>,
        );
      } else {
        result[key] = sourceObject[key];
      }
    }
  }

  return result as T;
}

function normalizeConfig(config: Config): Config {
  const legacy = config as Config & {
    llm?: Config["llm"] & {
      provider?: LLMProvider;
      model?: string;
      apiKey?: string;
      baseUrl?: string;
      cfAccountId?: string;
      cfGatewayId?: string;
      cfApiToken?: string;
    };
  };

  const legacyProvider = legacy.llm?.provider;
  const legacyModel = legacy.llm?.model;

  const providers = Array.isArray(config.llm.providers) ? [...config.llm.providers] : [];

  if (legacyProvider) {
    providers.splice(
      0,
      providers.length,
      ...upsertProviderConfig(providers, {
        name: legacyProvider,
        API_TOKEN: legacyProvider === "cloudflare" ? legacy.llm?.cfApiToken : legacy.llm?.apiKey,
        model: legacyModel,
        baseUrl: legacy.llm?.baseUrl,
        accountId: legacy.llm?.cfAccountId,
        gatewayId: legacy.llm?.cfGatewayId,
      }),
    );
  }

  const selectedProvider = config.llm.selected?.provider ?? legacyProvider ?? "openrouter";
  const selectedProviderConfig = providers.find((entry) => entry.name === selectedProvider);
  const selectedModel = config.llm.selected?.model ?? legacyModel ?? selectedProviderConfig?.model;

  return {
    ...config,
    llm: {
      selected: {
        provider: selectedProvider,
        model: selectedModel,
      },
      providers,
      customPrompt: config.llm.customPrompt,
    },
  };
}

function hasLegacyLlmConfig(rawConfig: unknown): boolean {
  if (!rawConfig || typeof rawConfig !== "object") {
    return false;
  }

  const llm = (rawConfig as { llm?: Record<string, unknown> }).llm;
  if (!llm || typeof llm !== "object") {
    return false;
  }

  return (
    "provider" in llm ||
    "model" in llm ||
    "apiKey" in llm ||
    "baseUrl" in llm ||
    "cfAccountId" in llm ||
    "cfGatewayId" in llm ||
    "cfApiToken" in llm
  );
}

async function persistMigratedConfig(config: Config): Promise<void> {
  await ensureConfigDir();
  await Bun.write(getPreferredConfigFile(), JSON.stringify(config, null, 2));
}

/**
 * Get config file path (for display purposes)
 */
export function getConfigPath(): string {
  return getPreferredConfigFile();
}

/**
 * Get config directory path
 */
export function getConfigDir(): string {
  return getPreferredConfigDir();
}
