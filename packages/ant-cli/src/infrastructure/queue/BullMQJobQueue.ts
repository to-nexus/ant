/**
 * BullMQJobQueue
 * 
 * BullMQ-based implementation of JobQueuePort.
 * Suitable for cloud/distributed deployments.
 * 
 * Features:
 * - Persistent job queue backed by Redis
 * - Distributed job processing across multiple workers
 * - Job retries with exponential backoff
 * - Progress tracking and real-time updates
 * - Job priorities and scheduling
 * 
 * Requirements:
 * - Redis server (standalone or cluster)
 * - ANT_REDIS_URL environment variable
 * - Separate worker process for job execution
 * 
 * @see 10-cloud-scalability-design.md Section 4.2
 */

import { Queue, QueueEvents, Job } from 'bullmq';
import {
  JobQueuePort,
  JobPayload,
  JobProgress,
  JobExecutionResult,
  JobQueueStatusValue,
  QueuePositionInfo
} from '../../core/ports/queue';
import { StateStorePort } from '../../core/ports/stateStore';
import { logger } from '../../utils/logger';
import { parseRedisUrl } from '../utils/redis';

// Queue configuration
const QUEUE_NAME = 'ant-jobs';
const JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 1000
  },
  removeOnComplete: {
    age: 24 * 3600,     // Keep completed jobs for 24 hours
    count: 1000         // Keep last 1000 completed jobs
  },
  removeOnFail: {
    age: 7 * 24 * 3600  // Keep failed jobs for 7 days
  }
};

export interface BullMQJobQueueOptions {
  redisUrl: string;
  queueName?: string;
}

export class BullMQJobQueue implements JobQueuePort {
  private queue: Queue;
  private queueEvents: QueueEvents;
  private stateStore: StateStorePort;
  
  private progressCallbacks = new Map<string, Set<(progress: JobProgress) => void>>();
  private completionCallbacks = new Map<string, Set<(result: JobExecutionResult) => void>>();

  constructor(options: BullMQJobQueueOptions, stateStore: StateStorePort) {
    const queueName = options.queueName || QUEUE_NAME;
    
    // Parse Redis URL for BullMQ connection (uses shared utility with TLS support)
    const connection = parseRedisUrl(options.redisUrl);

    this.queue = new Queue(queueName, { connection });
    this.queueEvents = new QueueEvents(queueName, { connection });
    this.stateStore = stateStore;

    this.setupEventHandlers();

    logger.info(`BullMQ job queue initialized: ${queueName}`, { component: 'BullMQJobQueue' });
  }

  private setupEventHandlers(): void {
    this.queueEvents.on('progress', (args: { jobId: string; data: any }) => {
      const { jobId, data } = args;
      const callbacks = this.progressCallbacks.get(jobId);
      if (callbacks) {
        const progress: JobProgress = {
          jobId,
          phase: data.phase,
          step: data.step,
          progress: data.progress,
          message: data.message
        };
        for (const callback of callbacks) {
          callback(progress);
        }
      }
    });

    this.queueEvents.on('completed', async (args: { jobId: string; returnvalue?: string }) => {
      const { jobId, returnvalue } = args;
      logger.info(`Job completed: ${jobId}`, { component: 'BullMQJobQueue' });
      
      // Parse result
      let parsedResult: any;
      try {
        parsedResult = returnvalue ? JSON.parse(returnvalue) : {};
      } catch {
        parsedResult = { raw: returnvalue };
      }
      
      const result: JobExecutionResult = {
        success: true,
        jobId,
        output: parsedResult
      };
      
      // Notify via callbacks (if any registered)
      const callbacks = this.completionCallbacks.get(jobId);
      if (callbacks) {
        for (const callback of callbacks) {
          callback(result);
        }
      }
      
      // Get job info from BullMQ job data for SSE broadcast context
      let projectId: string | undefined;
      let featureName: string | undefined;
      let userEmail: string | undefined;
      
      try {
        // ✅ Use BullMQ's getJob() to retrieve original job payload
        const bullJob = await this.queue.getJob(jobId);
        if (bullJob && bullJob.data) {
          const payload = bullJob.data as JobPayload;
          projectId = payload.projectId;
          featureName = payload.feature;
          // Construct user email from userContext if available
          const userContext = payload.userContext;
          if (userContext) {
            userEmail = `${userContext.userId}@${userContext.organizationId}`;
          }
          logger.debug(`Retrieved job context from BullMQ: ${jobId} (${projectId}/${featureName})`, { component: 'BullMQJobQueue' });
        }
      } catch (error) {
        logger.warn(`Failed to get job data for SSE context: ${jobId}`, { component: 'BullMQJobQueue' }, error);
      }
      
      // Broadcast job completion via Redis Pub/Sub for SSE
      // This allows API Server to notify UI clients
      // Use a global channel for job status updates (API server subscribes to this)
      try {
        await this.stateStore.publish('job:status:updates', {
          type: 'completed',
          jobId,
          status: 'completed',
          projectId,
          featureName,
          userEmail,
          result: parsedResult,
          timestamp: new Date().toISOString()
        });
        logger.debug(`Published job completion to Redis: ${jobId} (${projectId}/${featureName})`, { component: 'BullMQJobQueue' });
      } catch (error) {
        logger.error(`Failed to publish job completion: ${jobId}`, { component: 'BullMQJobQueue' }, error);
      }
      
      // Cleanup callbacks
      this.progressCallbacks.delete(jobId);
      this.completionCallbacks.delete(jobId);
    });

    this.queueEvents.on('failed', async (args: { jobId: string; failedReason?: string }) => {
      const { jobId, failedReason } = args;
      logger.error(`Job failed: ${jobId}`, { component: 'BullMQJobQueue' }, new Error(failedReason || 'Unknown error'));
      
      const callbacks = this.completionCallbacks.get(jobId);
      if (callbacks) {
        const result: JobExecutionResult = {
          success: false,
          jobId,
          error: failedReason
        };
        for (const callback of callbacks) {
          callback(result);
        }
      }
      
      // Cleanup callbacks
      this.progressCallbacks.delete(jobId);
      this.completionCallbacks.delete(jobId);
    });
  }

  // ============================================
  // JobQueuePort Implementation
  // ============================================

  async enqueue(payload: JobPayload): Promise<string> {
    const jobId = payload.jobId || this.generateJobId();

    // ✅ Resume support: Remove existing job and clear userStopped flag
    // This allows re-queuing a job with the same ID for resume/retry scenarios
    const existingJob = await this.queue.getJob(jobId);
    if (existingJob) {
      logger.info(`Removing existing job for resume: ${jobId}`, { component: 'BullMQJobQueue' });
      await existingJob.remove();
    }
    
    // ✅ CRITICAL: Clear userStopped flag for resume
    // Without this, JobWorker immediately cancels the resumed job
    await this.stateStore.clearUserStopped(jobId);
    logger.debug(`Cleared userStopped flag for job: ${jobId}`, { component: 'BullMQJobQueue' });

    // ✅ Track enqueue timestamp for delay measurement
    const enqueuedAt = Date.now();
    
    const job = await this.queue.add(
      payload.type,
      {
        ...payload,
        jobId,
        enqueuedAt  // ✅ For measuring enqueue → start delay
      },
      {
        jobId,
        ...JOB_OPTIONS,
        priority: payload.priority
      }
    );

    logger.info(`Job enqueued: ${job.id} at ${new Date(enqueuedAt).toISOString()}`, { component: 'BullMQJobQueue' }, { 
      jobType: payload.type,
      projectId: payload.projectId
    });

    // Initialize job status in state store
    await this.stateStore.setJobStatus(jobId, {
      jobId,
      projectId: payload.projectId,
      featureName: payload.featureName,
      status: 'queued',
      type: payload.type,
      mode: payload.mode,
      timestamp: new Date().toISOString(),
      userContext: payload.userContext
    });

    return jobId;
  }

  async getStatus(jobId: string): Promise<JobQueueStatusValue> {
    const job = await this.queue.getJob(jobId);
    
    if (!job) {
      return 'unknown';
    }

    const state = await job.getState();
    
    switch (state) {
      case 'waiting':
      case 'delayed':
        return 'queued';
      case 'active':
        return 'running';
      case 'completed':
        return 'completed';
      case 'failed':
        return 'failed';
      default:
        return 'unknown';
    }
  }

  async cancel(jobId: string): Promise<void> {
    const job = await this.queue.getJob(jobId);
    
    if (!job) {
      logger.warn(`Job not found for cancellation: ${jobId}`, { component: 'BullMQJobQueue' });
      return;
    }

    const state = await job.getState();
    
    if (state === 'active') {
      // For active jobs, we need to signal the worker to stop
      // This is done via the state store
      await this.stateStore.markUserStopped(jobId);
      logger.info(`Job cancellation requested: ${jobId}`, { component: 'BullMQJobQueue' });
    } else if (state === 'waiting' || state === 'delayed') {
      await job.remove();
      logger.info(`Job removed from queue: ${jobId}`, { component: 'BullMQJobQueue' });
    }
  }

  async getQueuePosition(jobId: string): Promise<QueuePositionInfo> {
    const job = await this.queue.getJob(jobId);
    
    if (!job) {
      return { status: 'unknown', position: null, totalWaiting: 0 };
    }

    const state = await job.getState();
    const status = this.mapStateToStatus(state);

    // If running or completed, not in queue
    if (state === 'active') {
      return { status: 'running', position: 0, totalWaiting: 0 };
    }
    
    if (state === 'completed' || state === 'failed') {
      return { status, position: null, totalWaiting: 0 };
    }

    // Get waiting jobs to calculate position
    if (state === 'waiting' || state === 'delayed') {
      const waitingJobs = await this.queue.getWaiting();
      const totalWaiting = waitingJobs.length;
      
      // Find position (1-based)
      const position = waitingJobs.findIndex(j => j.id === jobId) + 1;
      
      return {
        status: 'queued',
        position: position > 0 ? position : null,
        totalWaiting
      };
    }

    return { status, position: null, totalWaiting: 0 };
  }

  private mapStateToStatus(state: string): JobQueueStatusValue {
    switch (state) {
      case 'waiting':
      case 'delayed':
        return 'queued';
      case 'active':
        return 'running';
      case 'completed':
        return 'completed';
      case 'failed':
        return 'failed';
      default:
        return 'unknown';
    }
  }

  onProgress(jobId: string, callback: (progress: JobProgress) => void): () => void {
    if (!this.progressCallbacks.has(jobId)) {
      this.progressCallbacks.set(jobId, new Set());
    }
    this.progressCallbacks.get(jobId)!.add(callback);

    return () => {
      this.progressCallbacks.get(jobId)?.delete(callback);
      if (this.progressCallbacks.get(jobId)?.size === 0) {
        this.progressCallbacks.delete(jobId);
      }
    };
  }

  onComplete(jobId: string, callback: (result: JobExecutionResult) => void): () => void {
    if (!this.completionCallbacks.has(jobId)) {
      this.completionCallbacks.set(jobId, new Set());
    }
    this.completionCallbacks.get(jobId)!.add(callback);

    return () => {
      this.completionCallbacks.get(jobId)?.delete(callback);
      if (this.completionCallbacks.get(jobId)?.size === 0) {
        this.completionCallbacks.delete(jobId);
      }
    };
  }

  async getQueueStats(): Promise<{
    pending: number;
    running: number;
    completed: number;
    failed: number;
  }> {
    const [waiting, active, completed, failed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount()
    ]);

    return {
      pending: waiting,
      running: active,
      completed,
      failed
    };
  }

  async close(): Promise<void> {
    logger.info('Closing BullMQ job queue', { component: 'BullMQJobQueue' });
    
    await this.queueEvents.close();
    await this.queue.close();
    
    this.progressCallbacks.clear();
    this.completionCallbacks.clear();
  }

  // ============================================
  // Helper Methods
  // ============================================

  private generateJobId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${timestamp}${random}`;
  }

  // ============================================
  // Additional Methods (for admin/monitoring)
  // ============================================

  /**
   * Get job details from queue
   */
  async getJob(jobId: string): Promise<Job | null> {
    const job = await this.queue.getJob(jobId);
    return job ?? null;
  }

  /**
   * Get jobs by state
   */
  async getJobsByState(state: 'waiting' | 'active' | 'completed' | 'failed', count: number = 10): Promise<Job[]> {
    switch (state) {
      case 'waiting':
        return this.queue.getWaiting(0, count - 1);
      case 'active':
        return this.queue.getActive(0, count - 1);
      case 'completed':
        return this.queue.getCompleted(0, count - 1);
      case 'failed':
        return this.queue.getFailed(0, count - 1);
      default:
        return [];
    }
  }

  /**
   * Pause the queue
   */
  async pause(): Promise<void> {
    await this.queue.pause();
    logger.info('Job queue paused', { component: 'BullMQJobQueue' });
  }

  /**
   * Resume the queue
   */
  async resume(): Promise<void> {
    await this.queue.resume();
    logger.info('Job queue resumed', { component: 'BullMQJobQueue' });
  }

  /**
   * Clean old jobs
   */
  async clean(
    grace: number = 24 * 3600 * 1000,
    limit: number = 1000,
    type: 'completed' | 'wait' | 'active' | 'delayed' | 'failed' = 'completed'
  ): Promise<string[]> {
    return this.queue.clean(grace, limit, type);
  }
}
