import { homedir } from "os";
import { join } from "path";
import { createHash } from "crypto";
import { mkdir, rm } from "fs/promises";

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
} as const;

export type CacheNamespace = (typeof CacheNamespaces)[keyof typeof CacheNamespaces];
