#!/usr/bin/env node
/**
 * Preview Worker Entry Point
 * 
 * Starts a PreviewWorkerService that handles preview server management
 * for the RemotePreviewOrchestrator.
 * 
 * Usage:
 *   ANT_PREVIEW_WORKER_PORT=8080 npx tsx src/infrastructure/preview/start-preview-worker.ts
 * 
 * Environment Variables:
 *   ANT_PREVIEW_WORKER_PORT - Worker HTTP API port (default: 8080)
 *   ANT_REDIS_URL           - Optional Redis URL for log streaming
 * 
 * @see 10-cloud-scalability-design.md Section 3.2.3
 */

import 'dotenv/config';
import { startPreviewWorker } from './PreviewWorkerService';
import { logger } from '../../utils/logger';

async function main(): Promise<void> {
  logger.info('Starting Preview Worker process...', { component: 'PreviewWorkerProcess' });

  try {
    const worker = await startPreviewWorker();
    logger.info('Preview Worker is running. Press Ctrl+C to stop.', { component: 'PreviewWorkerProcess' });
    
    // Keep the process running
    await new Promise(() => {});
  } catch (error) {
    logger.error('Failed to start Preview Worker', { component: 'PreviewWorkerProcess' }, error);
    process.exit(1);
  }
}

main();
