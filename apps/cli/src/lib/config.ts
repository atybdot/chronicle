import { homedir } from "os";
import { join } from "path";
import { Result } from "better-result";
import type { Config } from "../types";
import { ConfigError } from "./errors";

const CONFIG_DIR = join(homedir(), ".config", "chronicle");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

const DEFAULT_CONFIG: Config = {
  llm: {
    provider: "openai",
    model: undefined,
    apiKey: undefined,
    baseUrl: undefined,
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
    await Bun.write(join(CONFIG_DIR, ".keep"), "");
  } catch {
    // Directory might already exist, that's fine
  }
}

/**
 * Load configuration from file
 */
export async function loadConfig(): Promise<Config> {
  try {
    const file = Bun.file(CONFIG_FILE);
    if (await file.exists()) {
      const content = await file.json();
      return deepMerge(DEFAULT_CONFIG, content);
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
      const file = Bun.file(CONFIG_FILE);
      if (await file.exists()) {
        const content = await file.json();
        return deepMerge(DEFAULT_CONFIG, content);
      }
      return DEFAULT_CONFIG;
    },
    catch: (e) =>
      new ConfigError({
        path: CONFIG_FILE,
        message: `Failed to load config: ${e instanceof Error ? e.message : String(e)}`,
      }),
  });
}

/**
 * Save configuration to file
 */
export async function saveConfig(config: Partial<Config>): Promise<void> {
  await ensureConfigDir();
  const currentConfig = await loadConfig();
  const newConfig = deepMerge(currentConfig, config);
  await Bun.write(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
}

/**
 * Save configuration with Result type
 */
export async function saveConfigSafe(config: Partial<Config>): Promise<Result<void, ConfigError>> {
  return Result.tryPromise({
    try: async () => {
      await ensureConfigDir();
      const currentConfig = await loadConfig();
      const newConfig = deepMerge(currentConfig, config);
      await Bun.write(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
    },
    catch: (e) =>
      new ConfigError({
        path: CONFIG_FILE,
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
export async function getApiKey(): Promise<string | undefined> {
  // Check unified environment variable first
  if (process.env[ENV_VAR_NAME]) {
    return process.env[ENV_VAR_NAME];
  }

  // Fall back to config
  const config = await loadConfig();
  return config.llm.apiKey;
}

/**
 * Check if API key is configured (either in env or config)
 */
export async function hasApiKey(): Promise<boolean> {
  const key = await getApiKey();
  return !!key;
}

/**
 * Get custom prompt for AI calls
 */
export async function getCustomPrompt(): Promise<string | undefined> {
  const config = await loadConfig();
  return config.llm.customPrompt;
}

/**
 * Deep merge two objects
 */
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key in source) {
    if (source[key] !== undefined) {
      if (typeof source[key] === "object" && source[key] !== null && !Array.isArray(source[key])) {
        result[key] = deepMerge(
          (target[key] ?? {}) as Record<string, unknown>,
          source[key] as Record<string, unknown>,
        ) as T[Extract<keyof T, string>];
      } else {
        result[key] = source[key] as T[Extract<keyof T, string>];
      }
    }
  }

  return result;
}

/**
 * Get config file path (for display purposes)
 */
export function getConfigPath(): string {
  return CONFIG_FILE;
}

/**
 * Get config directory path
 */
export function getConfigDir(): string {
  return CONFIG_DIR;
}
