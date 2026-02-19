#!/usr/bin/env node
/**
 * Job Worker Entry Point
 * 
 * Starts a JobWorker process that processes jobs from the BullMQ queue.
 * 
 * Usage:
 *   ANT_REDIS_URL=redis://localhost:6379 npm run dev:job-worker
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

async function main(): Promise<void> {
  logger.info(`Starting Job Worker process... (RECURSION_LIMIT: ${process.env.RECURSION_LIMIT || 'not set'})`, { component: 'JobWorkerProcess' });

  try {
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
