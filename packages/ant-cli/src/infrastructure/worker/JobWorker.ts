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
import { REDIS_CHANNELS } from '../state/redisConstants';
import { logger } from '../../utils/logger';
import { UnifiedWorkspaceResolver, WorkspacePathResolver } from '../workspace/WorkspaceResolver';
import { parseRedisUrl } from '../utils/redis';

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
   * Start the worker
   */
  async start(): Promise<void> {
    // ✅ Log critical environment variables for debugging (Cloud/Vault injection)
    logger.info('=== JobWorker Environment Variables ===', { component: 'JobWorker' });
    logger.info(`ANT_API_URL: ${process.env.ANT_API_URL || '(not set, will fallback to localhost)'}`, { component: 'JobWorker' });
    logger.info(`ANT_REDIS_URL: ${process.env.ANT_REDIS_URL ? '(set)' : '(not set)'}`, { component: 'JobWorker' });
    logger.info(`ANT_WORKSPACE_BASE_PATH: ${process.env.ANT_WORKSPACE_BASE_PATH || '(not set)'}`, { component: 'JobWorker' });
    logger.info('========================================', { component: 'JobWorker' });

    const queueName = this.options.queueName || QUEUE_NAME;
    // Parse Redis URL for BullMQ connection (uses shared utility with TLS support)
    const connection = parseRedisUrl(this.options.redisUrl);

    this.worker = new Worker(
      queueName,
      async (job: Job<JobPayload>) => this.processJob(job),
      {
        connection,
        concurrency: this.options.concurrency || DEFAULT_CONCURRENCY,
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
        // ✅ Lock-based stuck job detection
        // - lockDuration: 10 min
        // - Extension interval: 5 min (lockDuration / 2, BullMQ convention)
        // - stalledInterval: 5 min
        // - Dead Worker detected within: 10 min (expire) + 5 min (check) = ~15 min
        lockDuration: 600000,    // 10 minutes
        stalledInterval: 300000, // 5 minutes
        maxStalledCount: 1,      // Move to failed after 1 stall detection
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

    // ✅ Subscribe to stop signals from API server via Redis Pub/Sub
    await this.subscribeToStopSignals();

    logger.info(`JobWorker started: queue=${queueName}, concurrency=${this.options.concurrency || DEFAULT_CONCURRENCY}`, {
      component: 'JobWorker'
    });
  }

  /**
   * Subscribe to job stop signals via Redis Pub/Sub
   * When API server sends stop signal, kill the corresponding child process
   */
  private async subscribeToStopSignals(): Promise<void> {
    try {
      await this.stateStore.subscribe(REDIS_CHANNELS.JOB_WORKER.STOP, async (message: { jobId: string; projectId?: string; featureName?: string; timestamp: string }) => {
        const { jobId } = message;
        logger.info(`Received stop signal for job: ${jobId}`, { component: 'JobWorker', jobId });
        
        const childProcess = this.runningProcesses.get(jobId);
        if (childProcess && childProcess.pid) {
          logger.info(`Killing child process for job: ${jobId} (PID: ${childProcess.pid})`, { component: 'JobWorker', jobId });
          
          try {
            // Send SIGTERM for graceful shutdown.
            // The child process (job-runner) has a SIGTERM handler that:
            // 1. Calls orchestrator.handleInterruption() to push running tasks back
            // 2. Saves a final checkpoint to the session file
            // 3. Exits with code 143
            childProcess.kill('SIGTERM');
            
            // Wait up to 3s for graceful shutdown (child needs time to save checkpoint).
            // If the child exits early (graceful shutdown completed), proceed immediately.
            const GRACEFUL_TIMEOUT_MS = 3000;
            await new Promise<void>((resolve) => {
              const timeout = setTimeout(() => {
                childProcess.removeListener('exit', onExit);
                resolve();
              }, GRACEFUL_TIMEOUT_MS);
              
              const onExit = () => {
                clearTimeout(timeout);
                resolve();
              };
              childProcess.once('exit', onExit);
            });
            
            // Forcefully kill if still alive after grace period
            try {
              process.kill(childProcess.pid, 0);  // Check if still alive
              logger.info(`Process still alive after ${GRACEFUL_TIMEOUT_MS}ms grace period, sending SIGKILL: ${jobId}`, { component: 'JobWorker', jobId });
              process.kill(childProcess.pid, 'SIGKILL');
            } catch (checkErr: any) {
              logger.info(`Process exited gracefully: ${jobId}`, { component: 'JobWorker', jobId });
            }
            
            this.runningProcesses.delete(jobId);
            logger.info(`✅ Job stopped successfully: ${jobId}`, { component: 'JobWorker', jobId });
          } catch (error: any) {
            logger.error(`Error killing process for job: ${jobId}`, { component: 'JobWorker', jobId }, error);
            this.runningProcesses.delete(jobId);
          }
        } else {
          logger.warn(`No running process found for job: ${jobId}`, { component: 'JobWorker', jobId });
        }
      });
      
      logger.info(`Subscribed to ${REDIS_CHANNELS.JOB_WORKER.STOP} channel`, { component: 'JobWorker' });
    } catch (error: any) {
      logger.error(`Failed to subscribe to ${REDIS_CHANNELS.JOB_WORKER.STOP} channel`, { component: 'JobWorker' }, error);
    }
  }

  /**
   * Process a single job by spawning a child process
   */
  private async processJob(job: Job<JobPayload>): Promise<any> {
    const payload = job.data;
    const jobId = payload.jobId;

    // ⏱️ DEBUG: Record job receive time for latency analysis
    const receiveTime = Date.now();
    const receiveTimeISO = new Date(receiveTime).toISOString();
    
    // Calculate time since job was enqueued (our custom timestamp)
    const enqueuedAt = (payload as any).enqueuedAt as number | undefined;
    const enqueuedAtISO = enqueuedAt ? new Date(enqueuedAt).toISOString() : 'unknown';
    const enqueueToStartDelay = enqueuedAt ? receiveTime - enqueuedAt : 'unknown';
    
    // Also use BullMQ's timestamp for comparison
    const jobCreatedAt = job.timestamp; // BullMQ sets this when job is added
    const queueWaitTime = jobCreatedAt ? receiveTime - jobCreatedAt : 'unknown';
    
    // ✅ Use console.log for timing logs to ensure visibility regardless of LOG_LEVEL
    console.log(`⏱️ [JobTiming] Job received | jobId=${jobId} | enqueuedAt=${enqueuedAtISO} | receivedAt=${receiveTimeISO} | delay=${enqueueToStartDelay}ms | bullmqWait=${queueWaitTime}ms`);

    console.log(`[JobWorker] Processing job: ${jobId} (type=${payload.type}, project=${payload.projectId})`);

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

      // ⏱️ DEBUG: Record job execution start time
      const execStartTime = Date.now();
      const totalSetupTime = execStartTime - receiveTime;
      // ✅ Use console.log for timing logs to ensure visibility regardless of LOG_LEVEL
      console.log(`⏱️ [JobTiming] Starting child process | jobId=${jobId} | execStartTime=${new Date(execStartTime).toISOString()} | setupTimeMs=${totalSetupTime} | queueWaitTimeMs=${queueWaitTime}`);

      // Execute job in child process
      const result = await this.spawnJobProcess(job, payload);

      // ✅ Determine correct job status from result
      // A job can be "paused" (interruption with tasks remaining) even if outer success=true
      const outputStatus = result.output?.status;
      const hasInterruption = !!result.output?.interruption;
      let jobStatus: 'completed' | 'failed' | 'paused';
      if (outputStatus === 'paused' || hasInterruption) {
        jobStatus = 'paused';
      } else if (result.success) {
        jobStatus = 'completed';
      } else {
        jobStatus = 'failed';
      }
      
      // Update final status
      await this.stateStore.updateJobStatus(jobId, {
        status: jobStatus,
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
   * 
   * Lock Strategy (BullMQ convention: extend at lockDuration/2):
   * - lockDuration: 10 min
   * - Extension interval: 5 min (lockDuration / 2)
   * - stalledInterval: 5 min
   * - Dead Worker: 10 min (expire) + 5 min (check) = ~15 min to detect
   */
  private spawnJobProcess(job: Job<JobPayload>, payload: JobPayload): Promise<{ success: boolean; error?: string; output?: any }> {
    return new Promise((resolve, reject) => {
      const jobId = payload.jobId;
      
      // ✅ Extend lock at lockDuration/2 interval (BullMQ convention)
      const LOCK_DURATION = 600000;           // 10 minutes (must match Worker config)
      const LOCK_EXTENSION_INTERVAL = 300000; // 5 minutes (lockDuration / 2)
      
      const lockExtensionTimer = setInterval(async () => {
        try {
          await job.extendLock(job.token!, LOCK_DURATION);
        } catch (error: any) {
          // Lock extension failure is not critical - job continues
          logger.debug(`Lock extension failed for job: ${jobId}`, { component: 'JobWorker', jobId });
        }
      }, LOCK_EXTENSION_INTERVAL);
      
      const cleanup = () => clearInterval(lockExtensionTimer);
      
      // Build environment variables for the job process
      // ✅ Use centralized WorkspaceResolver for path calculation (no individual implementation)
      const workspaceBase = payload.workspacePath 
        || process.env.ANT_WORKSPACE_BASE_PATH 
        || WorkspacePathResolver.getPhysicalWorkspacesPath();
      
      const workspaceResolver = new UnifiedWorkspaceResolver(workspaceBase);
      const projectPath = workspaceResolver.getProjectPath(payload.userContext, payload.projectId);
      const featurePath = workspaceResolver.getFeaturePath(payload.userContext, payload.projectId, payload.feature);
      
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
        // Cloud: ANT_API_URL (e.g., http://ant-api:8080)
        // Local: fallback to localhost with PORT from npm script
        ANT_API_URL: process.env.ANT_API_URL || `http://localhost:${process.env.PORT || '4100'}`,
        // ✅ User authentication for Cloud mode HTTP clients
        ANT_USER_EMAIL: `${payload.userContext.userId}@${payload.userContext.organizationId}`
      };
      if (payload.overrideDirective) {
        env.ANT_OVERRIDE_DIRECTIVE = payload.overrideDirective;
      }
      if (payload.chatSource) {
        env.ANT_CHAT_SOURCE = 'true';
      }
      if (payload.skipTriage) {
        env.ANT_SKIP_TRIAGE = 'true';
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
        cleanup(); // Stop lock extension timer
        logger.info(`Child process exited with code: ${code}`, { component: 'JobWorker', jobId });
        
        // ✅ Parse RESULT from stdout regardless of exit code
        // Even on non-zero exit, the RESULT line may have been written before the error
        let parsedResult: any = { success: code === 0 };
        try {
          const resultMatch = stdout.match(/^RESULT:(\{.+\})$/m);
          if (resultMatch) {
            parsedResult = JSON.parse(resultMatch[1]);
            const hasInterruption = !!parsedResult.output?.interruption;
            const outputStatus = parsedResult.output?.status;
            // ✅ Use console.log to ensure visibility regardless of LOG_LEVEL
            console.log(`📋 [JobWorker] RESULT parsed | jobId=${jobId} | success=${parsedResult.success} | hasInterruption=${hasInterruption} | outputStatus=${outputStatus} | exitCode=${code}`);
          } else {
            // ✅ Regex didn't match - log for debugging
            const stdoutLen = stdout.length;
            const lastLines = stdout.split('\n').filter(Boolean).slice(-5).join(' | ');
            console.warn(`⚠️ [JobWorker] RESULT regex no match | jobId=${jobId} | stdoutLen=${stdoutLen} | exitCode=${code} | lastLines: ${lastLines.substring(0, 300)}`);
          }
        } catch (parseErr: any) {
          console.warn(`⚠️ [JobWorker] RESULT parse failed | jobId=${jobId} | error=${parseErr.message}`);
        }
        
        if (code === 0) {
          resolve(parsedResult);
        } else {
          logger.error(`Job runner failed: ${stderr || 'No stderr'}`, { component: 'JobWorker', jobId });
          // ✅ If RESULT was parsed (even with non-zero exit), use it (preserves interruption details)
          if (parsedResult.output) {
            resolve(parsedResult);
          } else {
            resolve({ 
              success: false, 
              error: stderr || `Process exited with code ${code}` 
            });
          }
        }
      });

      child.on('error', (err: Error) => {
        cleanup(); // Stop lock extension timer
        logger.error(`Failed to spawn job runner: ${err.message}`, { component: 'JobWorker', jobId }, err);
        reject(err);
      });

      // Handle cancellation during execution
      const checkCancellation = setInterval(async () => {
        const isStopped = await this.stateStore.isUserStopped(jobId);
        if (isStopped && child.pid) {
          clearInterval(checkCancellation);
          child.kill('SIGTERM');
          // ✅ FIX: Do NOT clear the isUserStopped flag here.
          // The RouteConfigurator's JOB_STATUS_UPDATES handler checks this flag
          // to skip duplicate cleanupJobState calls. If we clear it here, the handler
          // can't tell the job was user-stopped → calls cleanupJobState again →
          // cross-process race condition → completed tasks may be lost.
          // The flag is cleared by the RouteConfigurator after it checks it.
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
