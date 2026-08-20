#!/usr/bin/env node
/**
 * Job Worker Entry Point
 * 
 * Starts a JobWorker process that processes jobs from the BullMQ queue.
 * 
 * Usage:
 *   ANT_REDIS_URL=redis://localhost:16379 npm run dev:job-worker
 * 
 * Environment Variables:
 *   ANT_REDIS_URL        - Redis connection URL (required)
 *   ANT_JOB_QUEUE_NAME   - Queue name (default: 'ant-jobs')
 *   ANT_WORKER_CONCURRENCY - Number of concurrent jobs (default: 2)
 * 
 * @see 10-cloud-scalability-design.md Section 3.2.2
 */

import 'dotenv/config';
import { startJobWorker } from './JobWorker';
import { logger } from '../../utils/logger';
import { getInfrastructureFactory } from '../adapters/InfrastructureFactory';
import { applySharedWorkspaceUmask } from '../../core/config/childIdentity';
import { assertJwtAuthorityScope } from '../auth/JwtService';

async function main(): Promise<void> {
  logger.info(`Starting Job Worker process... (RECURSION_LIMIT: ${process.env.RECURSION_LIMIT || 'not set'})`, { component: 'JobWorkerProcess' });

  // The worker neither signs nor verifies sessions but spawns LLM-chosen shell
  // commands under its own UID. `dotenv/config` above means a direct-dotenv cloud
  // launch could load a live JWT secret into this env, reachable from those
  // commands via /proc — refuse to boot if any JWT key material is present
  // (M-NEW-016). Compose already withholds it; this makes that a guarantee.
  try {
    assertJwtAuthorityScope('none');
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error), { component: 'JobWorkerProcess' });
    process.exit(1);
  }

  // The worker spawns LLM-chosen shell commands; when they run under a separate
  // identity both sides need group-write in the shared workspace (no-op when unset).
  applySharedWorkspaceUmask();

  try {
    // Warm-load the cloud overlay (parity with API/realtime composition roots).
    await getInfrastructureFactory().initCloud();
    const worker = await startJobWorker();
    logger.info('Job Worker is running. Press Ctrl+C to stop.', { component: 'JobWorkerProcess' });
    
    // Keep the process running
    await new Promise(() => {});
  } catch (error) {
    logger.error('Failed to start Job Worker', { component: 'JobWorkerProcess' }, error);
    process.exit(1);
  }
}

main();
