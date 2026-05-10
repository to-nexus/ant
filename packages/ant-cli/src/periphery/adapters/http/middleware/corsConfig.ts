/**
 * Shared CORS Configuration
 *
 * Unified CORS config used by all three publicly exposed servers:
 * - ant-api
 * - ant-realtime
 * - ant-preview
 *
 * Single-origin deployments (FE + API on the same host) do not exercise
 * CORS — same-origin requests skip the origin header. The middleware
 * still passes them through (no `origin` header → allow). Sub-domain
 * split deployments add their FE / preview / staging origins via the
 * `ANT_CORS_ORIGINS` env (comma-separated). Localhost is permitted
 * unconditionally so a dev can run the FE locally against any backend.
 */

import cors from 'cors';

/**
 * Loopback-only predicate. Matches `http://localhost:*` and
 * `http://127.0.0.1:*` exactly (scheme + host prefix), so a malicious
 * origin like `https://localhost.attacker.com` cannot slip past via a
 * naive `.includes('localhost')`. The browser only emits these origins
 * when the request actually originates from the user's own machine, so
 * allowing them in production is safe — there's no remote attacker who
 * can forge a `localhost` Origin header.
 */
function isLoopbackOrigin(origin: string): boolean {
  return (
    origin.startsWith('http://localhost:') ||
    origin === 'http://localhost' ||
    origin.startsWith('http://127.0.0.1:') ||
    origin === 'http://127.0.0.1'
  );
}

/**
 * Create CORS middleware with environment-aware origin checking.
 *
 * Resolution order:
 * 1. Missing `Origin` header (same-origin / server-to-server / health) → allow.
 * 2. `ANT_CORS_ORIGINS` (csv) match → allow.
 * 3. `FRONTEND_URL` origin (split-host deployment) → allow.
 * 4. Loopback origin (`http://localhost:*` / `http://127.0.0.1:*`) → allow,
 *    in any mode. Loopback Origin headers cannot be forged remotely; this
 *    enables `pnpm dev:ui` against the production API without per-developer
 *    `ANT_CORS_ORIGINS` overrides.
 * 5. Otherwise → reject.
 */
export function createCorsMiddleware() {
  const extraOrigins = process.env.ANT_CORS_ORIGINS
    ? process.env.ANT_CORS_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
    : [];

  // Extract origin from FRONTEND_URL if set (split-host deployment)
  let frontendOrigin: string | null = null;
  if (process.env.FRONTEND_URL) {
    try {
      frontendOrigin = new URL(process.env.FRONTEND_URL).origin;
    } catch {
      // Invalid URL, ignore
    }
  }

  const allowedOrigins = new Set([
    ...extraOrigins,
    ...(frontendOrigin ? [frontendOrigin] : []),
  ]);

  const allowAllOrigins = allowedOrigins.has('*');

  return cors({
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }

      if (allowAllOrigins) {
        return callback(null, true);
      }

      if (allowedOrigins.has(origin)) {
        return callback(null, true);
      }

      if (isLoopbackOrigin(origin)) {
        return callback(null, true);
      }

      callback(new Error(`CORS not allowed for origin: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
}

/** Test-only export of the loopback predicate. */
export const __testing = { isLoopbackOrigin };
