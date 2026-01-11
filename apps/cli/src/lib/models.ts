import { Result } from "better-result";
import { getCache, setCache, CacheNamespaces } from "./cache";

/**
 * Model information returned from providers
 */
export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  contextLength?: number;
  isRecommended?: boolean;
}

/**
 * Provider configurations with recommended models and API endpoints
 */
export const PROVIDER_CONFIG = {
  openai: {
    name: "OpenAI",
    defaultModel: "gpt-4o",
    recommendedModels: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
    modelsEndpoint: "https://api.openai.com/v1/models",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    apiKeyInstructions: [
      "Go to OpenAI Platform → API Keys",
      "Click 'Create new secret key'",
      "Give it a name (e.g., 'chronicle') and copy the key",
    ],
  },
  anthropic: {
    name: "Anthropic Claude",
    defaultModel: "claude-sonnet-4-20250514",
    recommendedModels: [
      "claude-sonnet-4-20250514",
      "claude-3-5-sonnet-20241022",
      "claude-3-opus-20240229",
      "claude-3-haiku-20240307",
    ],
    // Anthropic doesn't have a public models list endpoint, use static list
    modelsEndpoint: null,
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    apiKeyInstructions: [
      "Go to Anthropic Console → Settings → API Keys",
      "Click 'Create Key'",
      "Give it a name (e.g., 'chronicle') and copy the key",
    ],
  },
  gemini: {
    name: "Google Gemini",
    defaultModel: "gemini-1.5-pro",
    recommendedModels: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
    modelsEndpoint: "https://generativelanguage.googleapis.com/v1beta/models",
    apiKeyUrl: "https://aistudio.google.com/app/apikey",
    apiKeyInstructions: [
      "Go to Google AI Studio → API Keys",
      "Click 'Create API key'",
      "Give it a name (e.g., 'chronicle') and copy the key",
    ],
  },
  openrouter: {
    name: "OpenRouter",
    defaultModel: "anthropic/claude-3.5-sonnet",
    recommendedModels: [
      "anthropic/claude-sonnet-4",
      "anthropic/claude-3.5-sonnet",
      "openai/gpt-4o",
      "google/gemini-pro-1.5",
      "meta-llama/llama-3.1-70b-instruct",
    ],
    modelsEndpoint: "https://openrouter.ai/api/v1/models",
    apiKeyUrl: "https://openrouter.ai/settings/keys",
    apiKeyInstructions: [
      "Go to OpenRouter → Settings → API Keys",
      "Click 'Create Key'",
      "Give it a name (e.g., 'chronicle') and copy the key",
    ],
  },
  ollama: {
    name: "Ollama (Local)",
    defaultModel: "llama3.2",
    recommendedModels: ["llama3.2", "llama3.1", "mistral", "codellama", "deepseek-coder"],
    modelsEndpoint: null, // Will use baseUrl + /api/tags
    apiKeyUrl: null,
    apiKeyInstructions: [
      "Ollama runs locally and doesn't require an API key",
      "Make sure Ollama is installed and running on your machine",
      "Visit https://ollama.com for installation instructions",
    ],
  },
} as const;

export type ProviderKey = keyof typeof PROVIDER_CONFIG;

/**
 * Fetch available models from OpenAI
 */
async function fetchOpenAIModels(apiKey: string): Promise<ModelInfo[]> {
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = (await response.json()) as { data: Array<{ id: string }> };
  const recommended = PROVIDER_CONFIG.openai.recommendedModels as readonly string[];

  // Filter to only GPT models and sort by relevance
  return data.data
    .filter(
      (m) =>
        m.id.startsWith("gpt-") &&
        !m.id.includes("instruct") &&
        !m.id.includes("vision") &&
        !m.id.includes("realtime") &&
        !m.id.includes("audio"),
    )
    .map((m) => ({
      id: m.id,
      name: m.id,
      isRecommended: recommended.includes(m.id),
    }))
    .sort((a: ModelInfo, b: ModelInfo) => {
      // Recommended first, then alphabetically
      if (a.isRecommended && !b.isRecommended) return -1;
      if (!a.isRecommended && b.isRecommended) return 1;
      return a.id.localeCompare(b.id);
    });
}

/**
 * Fetch available models from Google Gemini
 */
async function fetchGeminiModels(apiKey: string): Promise<ModelInfo[]> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
  );

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    models: Array<{
      name: string;
      displayName?: string;
      description?: string;
      supportedGenerationMethods?: string[];
    }>;
  };
  const recommended = PROVIDER_CONFIG.gemini.recommendedModels as readonly string[];

  return data.models
    .filter(
      (m) => m.supportedGenerationMethods?.includes("generateContent") && m.name.includes("gemini"),
    )
    .map((m) => {
      // name format is "models/gemini-1.5-pro" - extract just the model id
      const id = m.name.replace("models/", "");
      return {
        id,
        name: m.displayName || id,
        description: m.description,
        isRecommended: recommended.includes(id),
      };
    })
    .sort((a: ModelInfo, b: ModelInfo) => {
      if (a.isRecommended && !b.isRecommended) return -1;
      if (!a.isRecommended && b.isRecommended) return 1;
      return a.id.localeCompare(b.id);
    });
}

/**
 * Fetch available models from OpenRouter
 */
async function fetchOpenRouterModels(apiKey?: string): Promise<ModelInfo[]> {
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch("https://openrouter.ai/api/v1/models", { headers });

  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    data: Array<{
      id: string;
      name?: string;
      description?: string;
      context_length?: number;
    }>;
  };
  const recommended = PROVIDER_CONFIG.openrouter.recommendedModels;

  return data.data
    .map((m) => ({
      id: m.id,
      name: m.name || m.id,
      description: m.description,
      contextLength: m.context_length,
      isRecommended: recommended.some((r) => m.id.includes(r) || r.includes(m.id)),
    }))
    .sort((a: ModelInfo, b: ModelInfo) => {
      if (a.isRecommended && !b.isRecommended) return -1;
      if (!a.isRecommended && b.isRecommended) return 1;
      return a.id.localeCompare(b.id);
    });
}

/**
 * Fetch available models from local Ollama instance
 */
async function fetchOllamaModels(baseUrl: string = "http://localhost:11434"): Promise<ModelInfo[]> {
  const response = await fetch(`${baseUrl}/api/tags`);

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    models?: Array<{ name: string; size?: number; modified_at?: string }>;
  };
  const recommended = PROVIDER_CONFIG.ollama.recommendedModels;

  return (data.models || [])
    .map((m) => ({
      id: m.name.replace(":latest", ""),
      name: m.name.replace(":latest", ""),
      isRecommended: recommended.some((r) => m.name.includes(r)),
    }))
    .sort((a: ModelInfo, b: ModelInfo) => {
      if (a.isRecommended && !b.isRecommended) return -1;
      if (!a.isRecommended && b.isRecommended) return 1;
      return a.id.localeCompare(b.id);
    });
}

/**
 * Get static list of Anthropic models (no public API for listing)
 */
function getAnthropicModels(): ModelInfo[] {
  const models = [
    {
      id: "claude-sonnet-4-20250514",
      name: "Claude Sonnet 4",
      description: "Latest and most capable",
    },
    {
      id: "claude-3-5-sonnet-20241022",
      name: "Claude 3.5 Sonnet",
      description: "Fast and capable",
    },
    {
      id: "claude-3-opus-20240229",
      name: "Claude 3 Opus",
      description: "Most powerful for complex tasks",
    },
    {
      id: "claude-3-sonnet-20240229",
      name: "Claude 3 Sonnet",
      description: "Balanced performance",
    },
    { id: "claude-3-haiku-20240307", name: "Claude 3 Haiku", description: "Fastest, most compact" },
  ];

  const recommended = PROVIDER_CONFIG.anthropic.recommendedModels as readonly string[];
  return models.map((m) => ({
    ...m,
    isRecommended: recommended.includes(m.id),
  }));
}

/**
 * Fetch models for a given provider with caching
 */
export async function fetchModels(
  provider: ProviderKey,
  apiKey?: string,
  baseUrl?: string,
): Promise<Result<ModelInfo[], Error>> {
  // Generate cache key based on provider and API key hash
  const cacheKey = `${provider}:${apiKey ? "authenticated" : "default"}:${baseUrl ?? "default"}`;

  return Result.tryPromise({
    try: async () => {
      // Try to get from cache first (cache for 1 hour)
      const cached = await getCache<ModelInfo[]>(cacheKey, {
        namespace: CacheNamespaces.MODELS,
        ttl: 60 * 60 * 1000, // 1 hour
      });

      if (cached) {
        return cached;
      }

      let models: ModelInfo[];

      switch (provider) {
        case "openai":
          if (!apiKey) {
            // Return recommended models if no API key
            models = PROVIDER_CONFIG.openai.recommendedModels.map((id) => ({
              id,
              name: id,
              isRecommended: true,
            }));
          } else {
            models = await fetchOpenAIModels(apiKey);
          }
          break;

        case "anthropic":
          // Anthropic doesn't have a models list API
          models = getAnthropicModels();
          break;

        case "gemini":
          if (!apiKey) {
            models = PROVIDER_CONFIG.gemini.recommendedModels.map((id) => ({
              id,
              name: id,
              isRecommended: true,
            }));
          } else {
            models = await fetchGeminiModels(apiKey);
          }
          break;

        case "openrouter":
          // OpenRouter models endpoint works without auth
          models = await fetchOpenRouterModels(apiKey);
          break;

        case "ollama":
          try {
            models = await fetchOllamaModels(baseUrl);
          } catch {
            // Ollama might not be running, return recommended models
            models = PROVIDER_CONFIG.ollama.recommendedModels.map((id) => ({
              id,
              name: id,
              isRecommended: true,
            }));
          }
          break;

        default:
          models = [];
      }

      // Cache the results
      await setCache(cacheKey, models, {
        namespace: CacheNamespaces.MODELS,
        ttl: 60 * 60 * 1000, // 1 hour
      });

      return models;
    },
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  });
}

/**
 * Filter models by search query
 */
export function filterModels(models: ModelInfo[], query: string): ModelInfo[] {
  if (!query.trim()) return models;

  const lowerQuery = query.toLowerCase();
  return models.filter(
    (m) =>
      m.id.toLowerCase().includes(lowerQuery) ||
      m.name.toLowerCase().includes(lowerQuery) ||
      m.description?.toLowerCase().includes(lowerQuery),
  );
}
