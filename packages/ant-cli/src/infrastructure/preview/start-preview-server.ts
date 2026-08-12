#!/usr/bin/env node
/**
 * Preview Server Entry Point
 * 
 * Starts the ant-preview service according to 10-cloud-architecture.md
 * 
 * Handles:
 * - /preview/projects/:id/start - Start preview
 * - /preview/projects/:id/stop - Stop preview
 * - /preview/projects/:id/status - Get status
 * - /preview/:key/* - Preview Proxy
 * 
 * Environment Variables:
 *   PORT                      - Server port (default: 8080)
 *   ANT_REDIS_URL             - Redis URL (required)
 *   ANT_WORKSPACE_BASE_PATH   - Workspace base path
 *   ANT_SERVER_MODE           - 'local' or 'cloud'
 * 
 * @see docs/internals/02-infrastructure.md Section 3.2
 */

import 'dotenv/config';
import { createPreviewServer } from './PreviewServer';
import { logger } from '../../utils/logger';
import { logCorsConfigSummary } from '../../periphery/adapters/http/middleware/corsConfig';
import { getInfrastructureFactory } from '../adapters/InfrastructureFactory';
import { resolveRedisUrl } from '../../core/config/redisUrl';

async function main(): Promise<void> {
  const startTime = new Date().toISOString();
  
  logger.warn(`🚀 Starting Preview Server... (${startTime})`, {
    component: 'PreviewServerProcess'
  });
  
  // Local mode defaults, cloud mode fails fast (core/config/redisUrl.ts).
  try {
    resolveRedisUrl();
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error), {
      component: 'PreviewServerProcess'
    });
    process.exit(1);
  }

  logCorsConfigSummary();

  // Warm-load the cloud overlay before the deploy tier gate reads the credit
  // ledger (parity with API / realtime / worker composition roots). Without
  // this the factory's cloud getters would degrade to Noop and report a
  // phantom `tier: 'free'`, rejecting every paid-tier deploy.
  await getInfrastructureFactory().initCloud();

  try {
    await createPreviewServer();
    
    logger.warn('✅ Preview Server is running', {
      component: 'PreviewServerProcess'
    });
    
    // Keep process running
    await new Promise(() => {});
  } catch (error) {
    logger.error('Failed to start Preview Server', {
      component: 'PreviewServerProcess'
    }, error);
    process.exit(1);
  }
}

main();
