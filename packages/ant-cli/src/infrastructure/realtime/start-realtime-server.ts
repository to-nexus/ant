#!/usr/bin/env node
/**
 * Realtime Server Entry Point
 * 
 * Starts a dedicated SSE server for real-time updates.
 * Separated from API Server for independent scaling with Sticky Session.
 * 
 * Usage:
 *   npm run dev:realtime-server
 * 
 * Environment Variables:
 *   PORT                      - Server port (default: 8080, set via npm scripts for local dev)
 *   ANT_WORKSPACE_BASE_PATH   - Base path for workspaces (required)
 *   ANT_REDIS_URL             - Redis connection URL (required)
 *   ANT_CORS_ORIGINS          - Comma-separated CORS origins (optional)
 * 
 * @see docs/architecture/10-cloud-architecture.md
 */

import 'dotenv/config';
import { createRealtimeServer } from './RealtimeServer';
import { logger } from '../../utils/logger';
import { logCorsConfigSummary } from '../../periphery/adapters/http/middleware/corsConfig';

const PORT = parseInt(process.env.PORT || '8080', 10);
const WORKSPACES_PATH = process.env.ANT_WORKSPACE_BASE_PATH;
const CORS_ORIGINS = process.env.ANT_CORS_ORIGINS?.split(',').filter(Boolean);

async function main(): Promise<void> {
  const startTime = new Date().toISOString();
  logger.warn(`🚀 Starting Realtime Server... (${startTime})`, { component: 'RealtimeServerProcess' });
  
  // Validate required environment variables
  if (!WORKSPACES_PATH) {
    logger.error('ANT_WORKSPACE_BASE_PATH is required', { component: 'RealtimeServerProcess' });
    process.exit(1);
  }
  
  if (!process.env.ANT_REDIS_URL) {
    logger.error('ANT_REDIS_URL is required for Redis Pub/Sub', { component: 'RealtimeServerProcess' });
    process.exit(1);
  }
  
  logger.warn(`   Workspaces: ${WORKSPACES_PATH}`, { component: 'RealtimeServerProcess' });
  logger.warn(`   Port: ${PORT}`, { component: 'RealtimeServerProcess' });

  logCorsConfigSummary();
  
  try {
    const server = await createRealtimeServer({
      port: PORT,
      workspacesPath: WORKSPACES_PATH,
      corsOrigins: CORS_ORIGINS
    });
    
    logger.warn(`✅ Realtime Server listening on http://localhost:${PORT}`, { component: 'RealtimeServerProcess' });
    logger.warn(`📡 Ready for SSE connections`, { component: 'RealtimeServerProcess' });
    
    // Graceful shutdown handlers (once guard prevents re-entrant shutdown)
    let isShuttingDown = false;
    const shutdown = async (signal: string) => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      logger.warn(`${signal} received, shutting down gracefully...`, { component: 'RealtimeServerProcess' });
      await server.stop();
      process.exit(0);
    };
    
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    
    // Keep the process running
    await new Promise(() => {});
    
  } catch (error) {
    logger.error('Failed to start Realtime Server', { component: 'RealtimeServerProcess' }, error);
    process.exit(1);
  }
}

main();
