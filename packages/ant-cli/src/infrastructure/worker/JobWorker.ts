/**
 * JobWorker
 * 
 * BullMQ Worker that processes jobs from the queue.
 * This runs as a separate process in cloud mode.
 * 
 * The worker:
 * - Pulls jobs from BullMQ queue
 * - Spawns job execution child processes
 * - Reports progress back to the queue
 * - Handles graceful shutdown
 * 
 * Usage:
 *   ANT_REDIS_URL=redis://... npm run dev:worker
 * 
 * @see 10-cloud-scalability-design.md Section 3.2.2
 */

import { Worker, Job } from 'bullmq';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { StateStorePort } from '../../core/ports/stateStore';
import { JobPayload, JobProgress } from '../../core/ports/queue';
import { RedisStateStore } from '../state/RedisStateStore';
import { logger } from '../../utils/logger';

// ESM: derive __dirname from import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const QUEUE_NAME = 'ant-jobs';
const DEFAULT_CONCURRENCY = 2;

export interface JobWorkerOptions {
  redisUrl: string;
  queueName?: string;
  concurrency?: number;
}

export class JobWorker {
  private worker: Worker | null = null;
  private stateStore: StateStorePort;
  private runningProcesses = new Map<string, ChildProcess>();
  private isShuttingDown = false;
  private options: JobWorkerOptions;

  constructor(options: JobWorkerOptions) {
    this.options = options;
    
    // Create state store connection
    this.stateStore = new RedisStateStore({ url: options.redisUrl });

    logger.info(`JobWorker initialized for queue: ${options.queueName || QUEUE_NAME}`, { 
      component: 'JobWorker'
    });
  }

  /**
   * Parse Redis URL for BullMQ connection
   */
  private parseRedisUrl(url: string): { host: string; port: number; password?: string } {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port) || 6379,
      password: parsed.password || undefined
    };
  }

  /**
   * Start the worker
   */
  async start(): Promise<void> {
    const queueName = this.options.queueName || QUEUE_NAME;
    const connection = this.parseRedisUrl(this.options.redisUrl);

    this.worker = new Worker(
      queueName,
      async (job: Job<JobPayload>) => this.processJob(job),
      {
        connection,
        concurrency: this.options.concurrency || DEFAULT_CONCURRENCY,
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 }
      }
    );

    // Setup event handlers
    this.worker.on('completed', (job: Job) => {
      logger.info(`Job completed: ${job.id}`, { component: 'JobWorker', jobId: job.id });
    });

    this.worker.on('failed', (job: Job | undefined, err: Error) => {
      logger.error(`Job failed: ${job?.id}`, { component: 'JobWorker', jobId: job?.id }, err);
    });

    this.worker.on('error', (err: Error) => {
      logger.error('Worker error', { component: 'JobWorker' }, err);
    });

    logger.info(`JobWorker started: queue=${queueName}, concurrency=${this.options.concurrency || DEFAULT_CONCURRENCY}`, {
      component: 'JobWorker'
    });
  }

  /**
   * Process a single job by spawning a child process
   */
  private async processJob(job: Job<JobPayload>): Promise<any> {
    const payload = job.data;
    const jobId = payload.jobId;

    logger.info(`Processing job: ${jobId} (type=${payload.type}, project=${payload.projectId})`, {
      component: 'JobWorker',
      jobId
    });

    try {
      // Update status to running
      await this.stateStore.updateJobStatus(jobId, {
        status: 'running',
        startedAt: new Date().toISOString()
      });

      // Check if user requested cancellation
      const isStopped = await this.stateStore.isUserStopped(jobId);
      if (isStopped) {
        logger.info(`Job cancelled by user: ${jobId}`, { component: 'JobWorker', jobId });
        await this.stateStore.updateJobStatus(jobId, { status: 'paused' });
        return { cancelled: true };
      }

      // Execute job in child process
      const result = await this.spawnJobProcess(job, payload);

      // Update final status
      await this.stateStore.updateJobStatus(jobId, {
        status: result.success ? 'completed' : 'failed',
        completedAt: new Date().toISOString(),
        error: result.error
      });

      return result;

    } catch (error: any) {
      logger.error(`Job execution error: ${jobId}`, { component: 'JobWorker', jobId }, error);

      await this.stateStore.updateJobStatus(jobId, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: error.message
      });

      throw error;
    } finally {
      this.runningProcesses.delete(jobId);
    }
  }

  /**
   * Spawn a child process to execute the job
   */
  private spawnJobProcess(job: Job<JobPayload>, payload: JobPayload): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve, reject) => {
      const jobId = payload.jobId;
      
      // Build environment variables for the job process
      // Calculate project path: workspacePath/org/user/project
      const workspaceBase = payload.workspacePath || process.env.ANT_WORKSPACE_BASE_PATH || '/mnt/workspaces';
      const projectPath = path.join(
        workspaceBase,
        payload.userContext.organizationId,
        payload.userContext.userId,
        payload.projectId
      );
      const featurePath = path.join(projectPath, payload.feature);
      
      // CLI source/dist root for internal resource paths (templates, policies, etc.)
      // __dirname is dist/infrastructure/worker/ in production
      // We need dist/ root, not package root
      const cliRoot = path.resolve(__dirname, '../..');  // dist/infrastructure/worker/ → dist/
      
      const env: Record<string, string> = {
        ...process.env as Record<string, string>,
        ANT_JOB_ID: jobId,
        ANT_PROJECT_ID: payload.projectId,
        ANT_FEATURE: payload.feature,
        ANT_FEATURE_NAME: payload.feature,  // ✅ Alias for ChatAPIClient compatibility
        ANT_JOB_TYPE: payload.type,
        ANT_AGENT: payload.agent,
        ANT_MODE: payload.mode || 'generate',
        ANT_USER_ID: payload.userContext.userId,
        ANT_ORG_ID: payload.userContext.organizationId,
        ANT_REDIS_URL: this.options.redisUrl,
        // Project paths (user workspaces)
        ANT_PROJECT_PATH: projectPath,
        ANT_FEATURE_PATH: featurePath,
        ANT_WORKSPACE_PATH: workspaceBase,
        // CLI internal paths (for templates, policies, etc.)
        ANT_CLI_ROOT: cliRoot,
        // ✅ API Server connection for real-time updates (Kanban, FileTree, Workflow)
        // Cloud mode: use ANT_API_URL for service-to-service communication
        // Local mode: use ANT_CLI_PORT for localhost
        ANT_CLI_PORT: process.env.ANT_CLI_PORT || '4100',
        ANT_API_URL: process.env.ANT_API_URL || `http://localhost:${process.env.ANT_CLI_PORT || '4100'}`,
        // ✅ User authentication for Cloud mode HTTP clients
        ANT_USER_EMAIL: `${payload.userContext.userId}@${payload.userContext.organizationId}`
      };
      if (payload.overrideDirective) {
        env.ANT_OVERRIDE_DIRECTIVE = payload.overrideDirective;
      }
      if (payload.chatSource) {
        env.ANT_CHAT_SOURCE = 'true';
      }
      if (payload.inputFile) {
        env.ANT_INPUT_FILE = payload.inputFile;
      }
      if (payload.isResume) {
        env.ANT_IS_RESUME = 'true';
        if (payload.originalJobId) {
          env.ANT_ORIGINAL_JOB_ID = payload.originalJobId;
        }
      }

      // Path to the job runner script
      // Development: use .ts with tsx
      // Production: use compiled .js with node
      const isDev = process.env.NODE_ENV === 'development';
      
      let runnerScript: string;
      let command: string;
      let args: string[];
      
      if (isDev) {
        // Development: run TypeScript directly with tsx
        runnerScript = path.resolve(__dirname, '../../composition/job-runner.ts');
        command = 'npx';
        args = ['tsx', runnerScript];
      } else {
        // Production: esbuild maintains source structure
        // __dirname is dist/infrastructure/worker/ → go to dist/composition/
        runnerScript = path.resolve(__dirname, '../../composition/job-runner.js');
        command = 'node';
        args = [runnerScript];
      }
      
      logger.info(`Spawning job runner: ${runnerScript} (isDev=${isDev}, NODE_ENV=${process.env.NODE_ENV})`, { 
        component: 'JobWorker', 
        jobId 
      });
      
      logger.info(`Running: ${command} ${args.join(' ')}`, { component: 'JobWorker', jobId });
      
      const child = spawn(command, args, {
        env,
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      logger.info(`Child process spawned with PID: ${child.pid}`, { component: 'JobWorker', jobId });

      this.runningProcesses.set(jobId, child);

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', async (data: Buffer) => {
        const line = data.toString();
        stdout += line;
        
        // Log stdout for debugging
        console.log(`[job-runner:${jobId}] ${line.trim()}`);
        
        // Try to parse progress updates
        if (line.includes('PROGRESS:')) {
          try {
            const progressJson = line.split('PROGRESS:')[1].trim();
            const progress = JSON.parse(progressJson);
            await job.updateProgress(progress);
          } catch {
            // Ignore parse errors
          }
        }
        
        // Append to logs
        await this.stateStore.appendJobLog(jobId, {
          type: 'stdout',
          message: line,
          timestamp: new Date().toISOString()
        });
      });

      child.stderr?.on('data', async (data: Buffer) => {
        const line = data.toString();
        stderr += line;
        
        // Log stderr for debugging
        console.error(`[job-runner:${jobId}:stderr] ${line.trim()}`);
        
        await this.stateStore.appendJobLog(jobId, {
          type: 'stderr',
          message: line,
          timestamp: new Date().toISOString()
        });
      });

      child.on('close', (code: number | null) => {
        logger.info(`Child process exited with code: ${code}`, { component: 'JobWorker', jobId });
        
        if (code === 0) {
          resolve({ success: true });
        } else {
          logger.error(`Job runner failed: ${stderr || 'No stderr'}`, { component: 'JobWorker', jobId });
          resolve({ 
            success: false, 
            error: stderr || `Process exited with code ${code}` 
          });
        }
      });

      child.on('error', (err: Error) => {
        logger.error(`Failed to spawn job runner: ${err.message}`, { component: 'JobWorker', jobId }, err);
        reject(err);
      });

      // Handle cancellation during execution
      const checkCancellation = setInterval(async () => {
        const isStopped = await this.stateStore.isUserStopped(jobId);
        if (isStopped && child.pid) {
          clearInterval(checkCancellation);
          child.kill('SIGTERM');
          await this.stateStore.clearUserStopped(jobId);
        }
      }, 1000);

      child.on('close', () => {
        clearInterval(checkCancellation);
      });
    });
  }

  /**
   * Gracefully shutdown the worker
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    logger.info('JobWorker shutting down...', { component: 'JobWorker' });

    // Kill all running processes
    for (const [jobId, process] of this.runningProcesses) {
      logger.info(`Terminating job process: ${jobId}`, { component: 'JobWorker', jobId });
      process.kill('SIGTERM');
    }

    if (this.worker) {
      // Wait for current jobs to complete (30 second timeout)
      await this.worker.close();
    }

    await this.stateStore.close();

    logger.info('JobWorker shutdown complete', { component: 'JobWorker' });
  }
}

/**
 * Create and start a JobWorker from environment variables
 */
export async function startJobWorker(): Promise<JobWorker> {
  const redisUrl = process.env.ANT_REDIS_URL;
  if (!redisUrl) {
    throw new Error('ANT_REDIS_URL environment variable is required');
  }

  const worker = new JobWorker({
    redisUrl,
    queueName: process.env.ANT_JOB_QUEUE_NAME,
    concurrency: parseInt(process.env.ANT_WORKER_CONCURRENCY || '2')
  });

  await worker.start();

  // Handle shutdown signals
  const shutdown = async () => {
    await worker.shutdown();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return worker;
}
