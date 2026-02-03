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
 *   ANT_PREVIEW_PORT          - Server port (default: 4102)
 *   ANT_REDIS_URL            - Redis URL (required)
 *   ANT_WORKSPACE_BASE_PATH  - Workspace base path
 *   ANT_SERVER_MODE          - 'local' or 'cloud'
 * 
 * @see docs/architecture/10-cloud-architecture.md Section 3.2
 */

import 'dotenv/config';
import { createPreviewServer } from './PreviewServer';
import { logger } from '../../utils/logger';

async function main(): Promise<void> {
  const startTime = new Date().toISOString();
  
  logger.warn(`🚀 Starting Preview Server... (${startTime})`, {
    component: 'PreviewServerProcess'
  });
  
  // Validate required environment
  if (!process.env.ANT_REDIS_URL) {
    logger.error('ANT_REDIS_URL is required for Preview Server', {
      component: 'PreviewServerProcess'
    });
    process.exit(1);
  }

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
