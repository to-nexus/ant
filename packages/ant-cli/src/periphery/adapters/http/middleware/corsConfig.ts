/**
 * Shared CORS Configuration
 * 
 * Unified CORS config used by all three publicly exposed servers:
 * - ant-api
 * - ant-realtime
 * - ant-preview
 * 
 * Production: only *.example.com origins allowed.
 * Development: localhost origins also allowed.
 */

import cors from 'cors';

const PRODUCTION_ORIGINS = [
  'https://ant.example.com',
  'https://ant-server.example.com',
  'https://ant-preview.example.com',
];

/**
 * Create CORS middleware with environment-aware origin checking.
 * 
 * - Production (NODE_ENV=production): only *.example.com
 * - Development: also allows localhost/127.0.0.1
 * - ANT_CORS_ORIGINS env var can add additional origins (comma-separated)
 */
export function createCorsMiddleware() {
  const isProduction = process.env.NODE_ENV === 'production';

  // Build allowed origins from env
  const extraOrigins = process.env.ANT_CORS_ORIGINS
    ? process.env.ANT_CORS_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
    : [];

  return cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (same-origin, server-to-server, health checks)
      if (!origin) {
        return callback(null, true);
      }

      // Check production whitelist
      if (PRODUCTION_ORIGINS.includes(origin)) {
        return callback(null, true);
      }

      // Check wildcard *.example.com
      if (/^https:\/\/[a-zA-Z0-9-]+\.example\.com$/.test(origin)) {
        return callback(null, true);
      }

      // Check extra origins from env
      if (extraOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Allow localhost only in non-production
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
