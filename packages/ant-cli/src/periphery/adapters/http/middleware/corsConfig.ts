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
 * `ANT_CORS_ORIGINS` env (comma-separated). Localhost is permitted in
 * non-production for dev convenience.
 */

import cors from 'cors';

/**
 * Create CORS middleware with environment-aware origin checking.
 *
 * Resolution order:
 * 1. Missing `Origin` header (same-origin / server-to-server / health) → allow.
 * 2. `ANT_CORS_ORIGINS` (csv) match → allow.
 * 3. `FRONTEND_URL` origin (split-host deployment) → allow.
 * 4. Non-production + localhost / 127.0.0.1 → allow.
 * 5. Otherwise → reject.
 */
export function createCorsMiddleware() {
  const isProduction = process.env.NODE_ENV === 'production';

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

      if (!isProduction && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
        return callback(null, true);
      }

      callback(new Error(`CORS not allowed for origin: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
}
