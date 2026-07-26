import { homedir } from "os";
import { join } from "path";
import { createHash } from "crypto";
import { mkdir, rm, readdir, rename, unlink } from "fs/promises";
import type { AgentCommitPlan, Config, ExecutionState } from "../types";

function getCacheDir(): string {
  return process.env.CHRONICLE_CACHE_DIR ?? join(homedir(), ".cache", "chronicle");
}

interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl: number;
}

interface CacheOptions {
  ttl?: number; // Time to live in milliseconds (default: 1 hour)
  namespace?: string; // Cache namespace (default: "default")
}

const DEFAULT_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Generate cache key from input data
 */
export function generateCacheKey(data: unknown): string {
  const str = JSON.stringify(data);
  return createHash("sha256").update(str).digest("hex");
}

/**
 * Get cache file path for a given key and namespace
 */
function getCacheFilePath(key: string, namespace: string): string {
  return join(getCacheDir(), namespace, `${key}.json`);
}

/**
 * Ensure cache directory exists
 */
async function ensureCacheDir(namespace: string): Promise<void> {
  const dir = join(getCacheDir(), namespace);
  await mkdir(dir, { recursive: true });
}

/**
 * Check if cache entry is valid (not expired)
 */
function isValidEntry<T>(entry: CacheEntry<T>): boolean {
  const now = Date.now();
  return now - entry.timestamp < entry.ttl;
}

/**
 * Get cached value if it exists and is valid
 */
export async function getCache<T>(key: string, options: CacheOptions = {}): Promise<T | null> {
  const { namespace = "default" } = options;
  const cacheFile = getCacheFilePath(key, namespace);

  try {
    const file = Bun.file(cacheFile);
    if (!(await file.exists())) {
      return null;
    }

    const entry = (await file.json()) as CacheEntry<T>;

    if (!isValidEntry(entry)) {
      // Cache expired, delete it
      await file.delete();
      return null;
    }

    return entry.value;
  } catch {
    return null;
  }
}

/**
 * Set cache value
 */
export async function setCache<T>(
  key: string,
  value: T,
  options: CacheOptions = {},
): Promise<void> {
  const { namespace = "default", ttl = DEFAULT_TTL } = options;

  await ensureCacheDir(namespace);

  const entry: CacheEntry<T> = {
    value,
    timestamp: Date.now(),
    ttl,
  };

  const cacheFile = getCacheFilePath(key, namespace);
  await Bun.write(cacheFile, JSON.stringify(entry));
}

/**
 * Delete cached value
 */
export async function deleteCache(key: string, options: CacheOptions = {}): Promise<void> {
  const { namespace = "default" } = options;
  const cacheFile = getCacheFilePath(key, namespace);

  try {
    const file = Bun.file(cacheFile);
    if (await file.exists()) {
      await file.delete();
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Clear all cached values in a namespace
 */
export async function clearCache(namespace?: string): Promise<void> {
  const cacheDir = getCacheDir();
  const targetDir = namespace ? join(cacheDir, namespace) : cacheDir;

  try {
    await rm(targetDir, { recursive: true, force: true });
  } catch {
    // Ignore errors
  }
}

/**
 * Get cache statistics
 */
export async function getCacheStats(namespace?: string): Promise<{
  totalEntries: number;
  totalSize: number;
  oldestEntry: Date | null;
  newestEntry: Date | null;
}> {
  const cacheDir = getCacheDir();
  const targetDir = namespace ? join(cacheDir, namespace) : cacheDir;
  let totalEntries = 0;
  let totalSize = 0;
  let oldestTimestamp = Infinity;
  let newestTimestamp = 0;

  try {
    const dir = Bun.file(targetDir);
    if (!(await dir.exists())) {
      return { totalEntries: 0, totalSize: 0, oldestEntry: null, newestEntry: null };
    }

    // This is a simplified implementation
    // In production, you'd recursively read directories
    const entries: CacheEntry<unknown>[] = [];

    for await (const entry of entries) {
      totalEntries++;
      totalSize += JSON.stringify(entry).length;
      oldestTimestamp = Math.min(oldestTimestamp, entry.timestamp);
      newestTimestamp = Math.max(newestTimestamp, entry.timestamp);
    }
  } catch {
    // Ignore errors
  }

  return {
    totalEntries,
    totalSize,
    oldestEntry: oldestTimestamp === Infinity ? null : new Date(oldestTimestamp),
    newestEntry: newestTimestamp === 0 ? null : new Date(newestTimestamp),
  };
}

/**
 * Memoize a function with caching
 */
export function memoize<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  options: CacheOptions & { keyGenerator?: (...args: TArgs) => string } = {},
): (...args: TArgs) => Promise<TReturn> {
  const { keyGenerator = (...args) => generateCacheKey(args), ...cacheOptions } = options;

  return async (...args: TArgs): Promise<TReturn> => {
    const cacheKey = keyGenerator(...args);

    // Try to get from cache
    const cached = await getCache<TReturn>(cacheKey, cacheOptions);
    if (cached !== null) {
      return cached;
    }

    // Execute function
    const result = await fn(...args);

    // Cache the result
    await setCache(cacheKey, result, cacheOptions);

    return result;
  };
}

/**
 * Cache namespaces for different types of data
 */
export const CacheNamespaces = {
  AI_RESPONSES: "ai-responses",
  MODELS: "models",
  CONFIG: "config",
  GIT_STATUS: "git-status",
  PLANS: "plans",
} as const;

export type CacheNamespace = (typeof CacheNamespaces)[keyof typeof CacheNamespaces];

// ============================================================================
// Plan Cache (Ticket 12)
// ============================================================================

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function getPlansDir(): string {
  return join(getCacheDir(), "plans");
}

async function ensurePlansDir(): Promise<void> {
  await mkdir(getPlansDir(), { recursive: true });
}

function getPlanFilePath(planHash: string): string {
  return join(getPlansDir(), `${planHash}.json`);
}

function getStateFilePath(planHash: string): string {
  return join(getPlansDir(), `${planHash}.state.json`);
}

export const PlanCache = {
  /**
   * Compute SHA-256 hash of diff + config + intent + committed hunks.
   */
  computePlanHash(
    diff: string,
    config: Config,
    intent: string,
    committedHunkIds: string[]
  ): string {
    const data = JSON.stringify({
      diff,
      config,
      intent,
      committedHunkIds: committedHunkIds.sort(),
    });
    return createHash("sha256").update(data).digest("hex");
  },

  /**
   * Get cached plan for the given hash.
   * Returns null if no cache exists (not an error).
   */
  async getCachedPlan(planHash: string): Promise<Result<AgentCommitPlan | null>> {
    const planFile = getPlanFilePath(planHash);

    try {
      const file = Bun.file(planFile);
      if (!(await file.exists())) {
        return { ok: true, value: null };
      }

      const plan = (await file.json()) as AgentCommitPlan;
      return { ok: true, value: plan };
    } catch (error) {
      return {
        ok: false,
        error: `Failed to read cached plan: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  /**
   * Write the plan to the cache directory.
   * Creates plans directory if it doesn't exist.
   * Writes atomically via temp file.
   */
  async writePlanCache(plan: AgentCommitPlan, planHash: string): Promise<Result<void>> {
    await ensurePlansDir();
    const planFile = getPlanFilePath(planHash);
    const tempFile = `${planFile}.tmp`;

    try {
      await Bun.write(tempFile, JSON.stringify(plan, null, 2));
      await rename(tempFile, planFile);
      return { ok: true, value: undefined };
    } catch (error) {
      try {
        await unlink(tempFile);
      } catch {
        // Ignore cleanup errors
      }
      return {
        ok: false,
        error: `Failed to write plan cache: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  /**
   * Update execution state for a cached plan.
   */
  async updateExecutionState(
    planHash: string,
    state: ExecutionState
  ): Promise<Result<void>> {
    await ensurePlansDir();
    const stateFile = getStateFilePath(planHash);
    const tempFile = `${stateFile}.tmp`;

    try {
      await Bun.write(tempFile, JSON.stringify(state, null, 2));
      await rename(tempFile, stateFile);
      return { ok: true, value: undefined };
    } catch (error) {
      try {
        await unlink(tempFile);
      } catch {
        // Ignore cleanup errors
      }
      return {
        ok: false,
        error: `Failed to update execution state: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  /**
   * Get execution state for a cached plan.
   * Returns null if no state exists.
   */
  async getExecutionState(planHash: string): Promise<Result<ExecutionState | null>> {
    const stateFile = getStateFilePath(planHash);

    try {
      const file = Bun.file(stateFile);
      if (!(await file.exists())) {
        return { ok: true, value: null };
      }

      const state = (await file.json()) as ExecutionState;
      return { ok: true, value: state };
    } catch (error) {
      return {
        ok: false,
        error: `Failed to read execution state: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  /**
   * Delete cached plan and execution state for the given hash.
   */
  async invalidateCache(planHash: string): Promise<Result<void>> {
    const planFile = getPlanFilePath(planHash);
    const stateFile = getStateFilePath(planHash);

    try {
      try {
        await unlink(planFile);
      } catch {
        // Ignore if file doesn't exist
      }
      try {
        await unlink(stateFile);
      } catch {
        // Ignore if file doesn't exist
      }
      return { ok: true, value: undefined };
    } catch (error) {
      return {
        ok: false,
        error: `Failed to invalidate cache: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  /**
   * Delete all cached plans.
   */
  async invalidateAllCaches(): Promise<Result<void>> {
    try {
      await rm(getPlansDir(), { recursive: true, force: true });
      return { ok: true, value: undefined };
    } catch (error) {
      return {
        ok: false,
        error: `Failed to invalidate all caches: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  /**
   * List all cached plan hashes.
   */
  async listCachedPlans(): Promise<Result<string[]>> {
    await ensurePlansDir();
    const plansDir = getPlansDir();

    try {
      const files = await readdir(plansDir);
      const hashes = files
        .filter(f => f.endsWith(".json") && !f.endsWith(".state.json"))
        .map(f => f.replace(".json", ""));
      return { ok: true, value: hashes };
    } catch (error) {
      return {
        ok: false,
        error: `Failed to list cached plans: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
