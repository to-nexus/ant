/**
 * TransferExpiryQueue
 * 
 * BullMQ queue for scheduling transfer request expiry.
 * When a transfer request is created, a delayed job is added
 * to expire it after 7 days. Also handles cleanup of cancelled requests.
 * 
 * Worker processing:
 * - Checks if request is still pending → marks as expired
 * - Cleans up .transfers/<requestId>/ snapshot directory on EFS
 * - Removes Redis keys
 */

import { Queue, Worker, Job } from 'bullmq';
import * as fs from 'fs';
import * as path from 'path';
import { parseRedisUrl } from '../utils/redis';
import { RedisStateStore } from '../state/RedisStateStore';
import { REDIS_TTL } from '../state/redisConstants';
import { logger } from '../../utils/logger';

const QUEUE_NAME = 'ant-transfer-expiry';
const COMPONENT = 'TransferExpiryQueue';

export interface TransferExpiryJobData {
  requestId: string;
  orgId: string;
  snapshotDir: string;  // e.g., /mnt/workspaces/<orgId>/.transfers/<requestId>
}

export class TransferExpiryQueue {
  private queue: Queue;
  private worker: Worker | null = null;

  constructor(redisUrl: string) {
    const connection = parseRedisUrl(redisUrl);
    this.queue = new Queue(QUEUE_NAME, { connection });
    logger.info(`📦 [${COMPONENT}] Transfer expiry queue initialized`, { component: COMPONENT });
  }

  /**
   * Schedule a transfer request to expire after 7 days.
   * Called when a cross-user transfer request is created.
   */
  async scheduleExpiry(data: TransferExpiryJobData): Promise<void> {
    const delay = REDIS_TTL.TRANSFER.REQUEST * 1000; // 7 days in ms
    
    await this.queue.add('transfer-expiry', data, {
      jobId: `transfer-expiry-${data.requestId}`,
      delay,
      removeOnComplete: true,
      removeOnFail: { age: 24 * 3600 },  // Keep failed for 24h
    });

    logger.debug(`📦 [${COMPONENT}] Scheduled expiry for request ${data.requestId} (7 days)`, { component: COMPONENT });
  }

  /**
   * Start the worker that processes expiry jobs.
   * Should be called on the Worker pod(s).
   */
  startWorker(stateStore: RedisStateStore, redisUrl: string): void {
    if (this.worker) return;

    const connection = parseRedisUrl(redisUrl);

    this.worker = new Worker(QUEUE_NAME, async (job: Job<TransferExpiryJobData>) => {
      const { requestId, snapshotDir } = job.data;
      
      logger.info(`📦 [${COMPONENT}] Processing expiry for request ${requestId}`, { component: COMPONENT });

      // Check current status
      const request = await stateStore.getTransferRequest(requestId);
      
      if (request) {
        if (request.status === 'pending') {
          // Mark as expired
          await stateStore.updateTransferRequestStatus(requestId, 'expired');
          logger.info(`📦 [${COMPONENT}] Request ${requestId} expired`, { component: COMPONENT });
        }
        
        // Clean up snapshot for expired, cancelled, or rejected requests
        if (['expired', 'cancelled', 'rejected'].includes(request.status) || request.status === 'pending') {
          await this.cleanupSnapshot(snapshotDir);
        }
      } else {
        // Request already gone from Redis, just cleanup EFS
        await this.cleanupSnapshot(snapshotDir);
      }
    }, { connection, concurrency: 5 });

    this.worker.on('failed', (job, err) => {
      logger.error(`📦 [${COMPONENT}] Expiry job failed: ${job?.id} - ${err.message}`, { component: COMPONENT }, err);
    });

    logger.info(`📦 [${COMPONENT}] Worker started`, { component: COMPONENT });
  }

  /**
   * Clean up a snapshot directory on EFS.
   */
  private async cleanupSnapshot(snapshotDir: string): Promise<void> {
    try {
      if (fs.existsSync(snapshotDir)) {
        await fs.promises.rm(snapshotDir, { recursive: true, force: true });
        logger.debug(`📦 [${COMPONENT}] Cleaned up snapshot: ${snapshotDir}`, { component: COMPONENT });
      }
    } catch (error: any) {
      logger.warn(`📦 [${COMPONENT}] Failed to cleanup snapshot: ${snapshotDir} - ${error.message}`, { component: COMPONENT });
    }
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }
}
