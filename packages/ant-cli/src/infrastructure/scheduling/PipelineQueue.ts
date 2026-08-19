/**
 * PipelineQueue — BullMQ adapter for the `ant-pipelines` control queue
 * (`ScheduleQueuePort`). Cron triggers ride `upsertJobScheduler` (native
 * cluster-safe repeatables — no tick loop, no due-index ZSET); HITL timeout
 * arms and overlap re-arms ride one-shot delayed jobs. Control jobs are
 * idempotent (fire NX / gate NX downstream), so `attempts: 3` is safe here —
 * the `ant-jobs` attempts:1 invariant is a different queue's contract.
 */

import { Queue, Worker } from 'bullmq';
import { parseRedisUrl } from '../utils/redis';
import { logger } from '../../utils/logger';
import type { PipelineControlJobData, PipelineFireJobData, ScheduleQueuePort } from '../../core/ports/scheduler';

const QUEUE_NAME = 'ant-pipelines';

const CONTROL_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

export type PipelineControlHandler = (data: PipelineControlJobData, intendedFireAt: number) => Promise<void>;

export class PipelineQueue implements ScheduleQueuePort {
  private readonly queue: Queue;
  private worker: Worker | null = null;

  constructor(redisUrl: string) {
    this.queue = new Queue(QUEUE_NAME, { connection: parseRedisUrl(redisUrl) });
  }

  async upsertCron(schedulerId: string, cron: string, tz: string | undefined, data: PipelineFireJobData): Promise<void> {
    await this.queue.upsertJobScheduler(
      schedulerId,
      { pattern: cron, ...(tz ? { tz } : {}) },
      { name: 'fire', data, opts: CONTROL_JOB_OPTIONS },
    );
  }

  async removeCron(schedulerId: string): Promise<void> {
    await this.queue.removeJobScheduler(schedulerId);
  }

  async listCronIds(): Promise<string[]> {
    const schedulers = await this.queue.getJobSchedulers(0, -1, true);
    return schedulers.map((s) => s.key).filter(Boolean);
  }

  async armDelayed(jobId: string, delayMs: number, data: PipelineControlJobData): Promise<void> {
    // Re-arm semantics: replace any previous arm under the same id.
    await this.cancelDelayed(jobId);
    await this.queue.add(data.kind, data, { jobId, delay: delayMs, ...CONTROL_JOB_OPTIONS });
  }

  async cancelDelayed(jobId: string): Promise<void> {
    try {
      const existing = await this.queue.getJob(jobId);
      if (existing) await existing.remove();
    } catch (err) {
      logger.warn(`[PipelineQueue] cancelDelayed(${jobId}) failed`, { component: 'PipelineQueue' }, err);
    }
  }

  async addNow(data: PipelineControlJobData): Promise<void> {
    await this.queue.add(data.kind, data, CONTROL_JOB_OPTIONS);
  }

  /**
   * Start the control worker. `intendedFireAt` approximates the slot a
   * scheduler-produced job was due (creation time + delay) — the missed-fire
   * policy compares it against now.
   */
  startWorker(redisUrl: string, handler: PipelineControlHandler): void {
    if (this.worker) return;
    this.worker = new Worker(
      QUEUE_NAME,
      async (job) => {
        const intendedFireAt = job.timestamp + (job.opts.delay ?? 0);
        await handler(job.data as PipelineControlJobData, intendedFireAt);
      },
      { connection: parseRedisUrl(redisUrl), concurrency: 4 },
    );
    this.worker.on('failed', (job, err) => {
      logger.warn(`[PipelineQueue] control job failed: ${job?.name} ${job?.id}`, { component: 'PipelineQueue' }, err);
    });
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }
}
