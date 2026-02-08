import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
import fs from "fs";
import path from "path";

// Load .env.local for drizzle-kit
config({ path: ".env.local" });

/**
 * Find local D1 database file created by wrangler dev
 * D1 local files are stored in .wrangler/state/v3/d1/miniflare-D1DatabaseObject/
 */
function getLocalD1DbPath(): string | null {
  try {
    const basePath = path.resolve(".wrangler/state/v3/d1");
    if (!fs.existsSync(basePath)) return null;

    const files = fs.readdirSync(basePath, { recursive: true }) as string[];
    const dbFile = files.find(
      (f) => f.endsWith(".sqlite") || f.endsWith(".db")
    );

    if (dbFile) {
      return path.join(basePath, dbFile);
    }
  } catch {
    // Fallback: search recursively
    try {
      const wranglerPath = path.resolve(".wrangler");
      if (!fs.existsSync(wranglerPath)) return null;

      const findDb = (dir: string): string | null => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            const found = findDb(fullPath);
            if (found) return found;
          } else if (entry.name.endsWith(".sqlite") || entry.name.endsWith(".db")) {
            return fullPath;
          }
        }
        return null;
      };

      return findDb(wranglerPath);
    } catch {
      return null;
    }
  }
  return null;
}

const localDbPath = getLocalD1DbPath();
// Default to local DB for development. Set DRIZZLE_REMOTE=true to use Cloudflare API
const isRemote = process.env.DRIZZLE_REMOTE === "true";
const isLocal = !isRemote && !!localDbPath;

console.log(
  isLocal && localDbPath
    ? `Using local D1 database: ${localDbPath}`
    : isRemote
      ? "Using remote D1 database (Cloudflare API)"
      : "No local database found. Run 'wrangler dev' first or set DRIZZLE_REMOTE=true"
);

// Local config - uses SQLite file directly (no driver field needed)
const localConfig = {
  schema: "./src/backend/db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "sqlite" as const,
  dbCredentials: {
    url: localDbPath || ":memory:",
  },
};

// Remote config - uses D1 HTTP API
const remoteConfig = {
  schema: "./src/backend/db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "sqlite" as const,
  driver: "d1-http" as const,
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
    databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID!,
    token: process.env.CLOUDFLARE_API_TOKEN!,
  },
};

export default defineConfig(isLocal && localDbPath ? localConfig : remoteConfig);
