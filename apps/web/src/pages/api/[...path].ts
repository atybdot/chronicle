/**
 * Astro API Endpoint Bridge for Hono
 * 
 * All /api/* requests are handled by the Hono backend.
 * Example: /api/v1/batch → Hono receives /v1/batch
 */

import type { APIRoute } from "astro";
import app from "../../backend";

// This route is server-side only (Cloudflare Worker)
export const prerender = false;

/**
 * Handle all HTTP methods via Hono backend
 */
export const ALL: APIRoute = async (context) => {
  const runtime = (context.locals as { runtime?: { env: CloudflareBindings } }).runtime;

  if (!runtime?.env) {
    return Response.json({ error: "Runtime environment not available" }, { status: 500 });
  }

  // Strip /api prefix so Hono receives /v1/* paths
  const url = new URL(context.request.url);
  const pathWithoutApi = url.pathname.replace(/^\/api/, "");
  const cleanUrl = new URL(pathWithoutApi + url.search, url.origin);

  // Forward request to Hono
  const request = new Request(cleanUrl, context.request);
  return app.fetch(request, runtime.env);
};
