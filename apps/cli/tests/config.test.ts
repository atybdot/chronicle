import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

async function withTempHome<T>(run: (home: string) => Promise<T>): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), "chronicle-config-"));
  const configDir = join(home, ".config", "chronicle");
  const previousConfigDir = process.env.CHRONICLE_CONFIG_DIR;
  process.env.CHRONICLE_CONFIG_DIR = configDir;

  try {
    return await run(home).then(async (result) => {
      await rm(home, { recursive: true, force: true });
      return result;
    }).finally(() => {
      process.env.CHRONICLE_CONFIG_DIR = previousConfigDir;
    });
  } catch (error) {
    process.env.CHRONICLE_CONFIG_DIR = previousConfigDir;
    await rm(home, { recursive: true, force: true });
    throw error;
  }
}

describe("config migration and multi-provider persistence", () => {
  test("migrates legacy single-provider config into providers array", async () => {
    await withTempHome(async (home) => {
      const configDir = join(home, ".config", "chronicle");
      const configPath = join(configDir, "config.json");
      await mkdir(configDir, { recursive: true });
      await Bun.write(
        configPath,
        JSON.stringify({
          llm: {
            provider: "openrouter",
            model: "anthropic/claude-sonnet-4",
            apiKey: "legacy-openrouter-key",
          },
          git: {},
          defaults: {},
        })
      );

      const configModule = await import(`../src/lib/config.ts?load=${Date.now()}-${Math.random()}`);
      const config = await configModule.loadConfig();

      expect(config.llm.selected.provider).toBe("openrouter");
      expect(config.llm.selected.model).toBe("anthropic/claude-sonnet-4");
      expect(config.llm.providers).toHaveLength(1);
      expect(config.llm.providers[0]).toMatchObject({
        name: "openrouter",
        API_TOKEN: "legacy-openrouter-key",
        model: "anthropic/claude-sonnet-4",
      });

      const persisted = await Bun.file(configPath).json();
      expect(persisted).toMatchObject({
        llm: {
          selected: {
            provider: "openrouter",
            model: "anthropic/claude-sonnet-4",
          },
          providers: [
            {
              name: "openrouter",
              API_TOKEN: "legacy-openrouter-key",
              model: "anthropic/claude-sonnet-4",
            },
          ],
        },
      });
      expect((persisted as { llm: Record<string, unknown> }).llm.provider).toBeUndefined();
    });
  });

  test("preserves multiple provider configs while switching selected provider", async () => {
    await withTempHome(async () => {
      const configModule = await import(`../src/lib/config.ts?save=${Date.now()}-${Math.random()}`);

      await configModule.saveConfig({
        llm: {
          selected: { provider: "openrouter", model: "anthropic/claude-sonnet-4" },
          providers: [
            {
              name: "openrouter",
              API_TOKEN: "openrouter-key",
              model: "anthropic/claude-sonnet-4",
            },
          ],
        },
      });

      await configModule.saveConfig({
        llm: {
          selected: { provider: "groq", model: "openai/gpt-oss-20b" },
          providers: configModule.upsertProviderConfig(
            (await configModule.loadConfig()).llm.providers,
            {
              name: "groq",
              API_TOKEN: "groq-key",
              model: "openai/gpt-oss-20b",
            }
          ),
        },
      });

      const config = await configModule.loadConfig();

      expect(config.llm.selected.provider).toBe("groq");
      expect(config.llm.providers).toHaveLength(2);
      expect(config.llm.providers.find((provider: { name: string }) => provider.name === "openrouter"))
        .toMatchObject({ API_TOKEN: "openrouter-key" });
      expect(config.llm.providers.find((provider: { name: string }) => provider.name === "groq"))
        .toMatchObject({ API_TOKEN: "groq-key" });
    });
  });

  test("saveConfig clears cached AI responses when selected model changes", async () => {
    await withTempHome(async (home) => {
      const configDir = join(home, ".config", "chronicle");
      const cacheDir = join(home, ".cache", "chronicle-test");
      const previousCacheDir = process.env.CHRONICLE_CACHE_DIR;
      process.env.CHRONICLE_CACHE_DIR = cacheDir;

      try {
        const configModule = await import(`../src/lib/config.ts?cache-model=${Date.now()}-${Math.random()}`);
        const cacheModule = await import(`../src/lib/cache.ts?cache-model=${Date.now()}-${Math.random()}`);

        await mkdir(configDir, { recursive: true });
        await configModule.saveConfig({
          llm: {
            selected: { provider: "openrouter", model: "model-a" },
            providers: [{ name: "openrouter", API_TOKEN: "token-a", model: "model-a" }],
          },
        });

        await cacheModule.setCache(
          "analysis-key",
          { object: { ok: true } },
          { namespace: cacheModule.CacheNamespaces.AI_RESPONSES, ttl: 60_000 },
        );

        expect(
          await cacheModule.getCache("analysis-key", {
            namespace: cacheModule.CacheNamespaces.AI_RESPONSES,
            ttl: 60_000,
          }),
        ).toEqual({ object: { ok: true } });

        await configModule.saveConfig({
          llm: {
            selected: { provider: "openrouter", model: "model-b" },
            providers: [{ name: "openrouter", API_TOKEN: "token-a", model: "model-b" }],
          },
        });

        expect(
          await cacheModule.getCache("analysis-key", {
            namespace: cacheModule.CacheNamespaces.AI_RESPONSES,
            ttl: 60_000,
          }),
        ).toBeNull();
      } finally {
        process.env.CHRONICLE_CACHE_DIR = previousCacheDir;
      }
    });
  });

  test("saveConfig does not clear cached AI responses for unrelated config changes", async () => {
    await withTempHome(async (home) => {
      const cacheDir = join(home, ".cache", "chronicle-test");
      const previousCacheDir = process.env.CHRONICLE_CACHE_DIR;
      process.env.CHRONICLE_CACHE_DIR = cacheDir;

      try {
        const configModule = await import(`../src/lib/config.ts?cache-other=${Date.now()}-${Math.random()}`);
        const cacheModule = await import(`../src/lib/cache.ts?cache-other=${Date.now()}-${Math.random()}`);

        await configModule.saveConfig({
          llm: {
            selected: { provider: "openrouter", model: "model-a" },
            providers: [{ name: "openrouter", API_TOKEN: "token-a", model: "model-a" }],
          },
        });

        await cacheModule.setCache(
          "analysis-key",
          { object: { ok: true } },
          { namespace: cacheModule.CacheNamespaces.AI_RESPONSES, ttl: 60_000 },
        );

        await configModule.saveConfig({
          defaults: {
            dryRun: false,
          },
        });

        expect(
          await cacheModule.getCache("analysis-key", {
            namespace: cacheModule.CacheNamespaces.AI_RESPONSES,
            ttl: 60_000,
          }),
        ).toEqual({ object: { ok: true } });
      } finally {
        process.env.CHRONICLE_CACHE_DIR = previousCacheDir;
      }
    });
  });

  test("handleConfigCacheClear removes all cache namespaces", async () => {
    await withTempHome(async (home) => {
      const cacheDir = join(home, ".cache", "chronicle-test");
      const previousCacheDir = process.env.CHRONICLE_CACHE_DIR;
      process.env.CHRONICLE_CACHE_DIR = cacheDir;

      try {
        const cacheModule = await import(`../src/lib/cache.ts?cache-clear=${Date.now()}-${Math.random()}`);
        const configCommandModule = await import(`../src/commands/config.ts?cache-clear=${Date.now()}-${Math.random()}`);

        await cacheModule.setCache("ai-key", { ok: true }, {
          namespace: cacheModule.CacheNamespaces.AI_RESPONSES,
          ttl: 60_000,
        });
        await cacheModule.setCache("models-key", { ok: true }, {
          namespace: cacheModule.CacheNamespaces.MODELS,
          ttl: 60_000,
        });

        expect(
          await cacheModule.getCache("ai-key", {
            namespace: cacheModule.CacheNamespaces.AI_RESPONSES,
            ttl: 60_000,
          }),
        ).toEqual({ ok: true });
        expect(
          await cacheModule.getCache("models-key", {
            namespace: cacheModule.CacheNamespaces.MODELS,
            ttl: 60_000,
          }),
        ).toEqual({ ok: true });

        await configCommandModule.handleConfigCacheClear();

        expect(
          await cacheModule.getCache("ai-key", {
            namespace: cacheModule.CacheNamespaces.AI_RESPONSES,
            ttl: 60_000,
          }),
        ).toBeNull();
        expect(
          await cacheModule.getCache("models-key", {
            namespace: cacheModule.CacheNamespaces.MODELS,
            ttl: 60_000,
          }),
        ).toBeNull();
      } finally {
        process.env.CHRONICLE_CACHE_DIR = previousCacheDir;
      }
    });
  });
});
