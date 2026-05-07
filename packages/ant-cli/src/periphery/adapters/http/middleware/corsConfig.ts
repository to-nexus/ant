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
 * 3. Non-production + localhost / 127.0.0.1 → allow.
 * 4. Otherwise → reject.
 */
export function createCorsMiddleware() {
  const isProduction = process.env.NODE_ENV === 'production';

  const extraOrigins = process.env.ANT_CORS_ORIGINS
    ? process.env.ANT_CORS_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
    : [];

  return cors({
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }

      if (extraOrigins.includes(origin)) {
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
