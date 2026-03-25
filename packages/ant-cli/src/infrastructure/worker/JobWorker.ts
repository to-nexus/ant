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
import { LOCK_DURATION, LOCK_EXTENSION_INTERVAL, STALLED_INTERVAL, CANCELLATION_POLL_INTERVAL } from '../queue/constants';
import { logger } from '../../utils/logger';
import { UnifiedWorkspaceResolver, WorkspacePathResolver } from '../workspace/WorkspaceResolver';
import { readBranchBaseFromConfig, isBaseBranch } from '../../core/utils/branchUtils';
import { parseRedisUrl } from '../utils/redis';
import { CredentialsStore, GitHubCredentials, buildCredentialEnv } from '../../utils/userConfig';
import * as fs from 'fs';

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
   * Send SIGTERM to a child process and SIGKILL after grace period if still alive.
   * Unified kill pattern used by: stalled handler, stop signal, lock expiry, re-processed job cleanup.
   */
  private async killChildGracefully(child: ChildProcess, jobId: string, gracePeriodMs: number = 3000): Promise<void> {
    if (!child.pid) return;

    child.kill('SIGTERM');

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        child.removeListener('exit', onExit);
        resolve();
      }, gracePeriodMs);
      const onExit = () => {
        clearTimeout(timeout);
        resolve();
      };
      child.once('exit', onExit);
    });

    // SIGKILL if still alive
    try {
      process.kill(child.pid, 0);
      logger.info(`Process still alive after ${gracePeriodMs}ms, sending SIGKILL: ${jobId}`, { component: 'JobWorker', jobId });
      process.kill(child.pid, 'SIGKILL');
    } catch {
      // Already exited — expected path
    }
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
        lockDuration: LOCK_DURATION,
        stalledInterval: STALLED_INTERVAL,
        maxStalledCount: 0,        // Never re-queue stalled jobs (prevents double-child on Mac sleep/wake)
        skipLockRenewal: true,     // Manual extension only — enables reliable failure detection
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

    this.worker.on('stalled', async (jobId: string) => {
      logger.warn(`Job stalled (worker crash detected): ${jobId}`, { component: 'JobWorker', jobId });

      // Kill the child process for this stalled job (if running in this pod)
      const stalledChild = this.runningProcesses.get(jobId);
      if (stalledChild && stalledChild.pid) {
        logger.warn(`Killing stalled child process: ${jobId} (PID: ${stalledChild.pid})`, { component: 'JobWorker', jobId });
        // Short grace period — stalled handler should be fast
        this.killChildGracefully(stalledChild, jobId, 2000).catch(() => {});
        this.runningProcesses.delete(jobId);
      }

      // Multi-pod idempotency: multiple Worker pods may detect the same stalled job.
      // Shares lock key with BullMQJobQueue's stalled handler on API Server pods.
      const acquired = await this.stateStore.acquireLock(`ant:job-stalled:${jobId}`, 120);
      if (!acquired) {
        logger.debug(`Duplicate stalled event blocked: ${jobId}`, { component: 'JobWorker', jobId });
        return;
      }

      // Skip if already handled (e.g. by StaleJobRecovery on startup)
      const currentStatus = await this.stateStore.getJobStatus(jobId);
      if (currentStatus && currentStatus.status !== 'running' && currentStatus.status !== 'queued') {
        logger.debug(`Job ${jobId} already resolved (status=${currentStatus.status}), skipping stalled handler`, { component: 'JobWorker', jobId });
        return;
      }

      try {
        await this.stateStore.updateJobStatus(jobId, {
          status: 'paused',
          completedAt: new Date().toISOString(),
          error: 'Worker crashed — job interrupted',
        });

        // Resolve projectId/featureName from Redis mapping so the RouteConfigurator
        // handler on the API Server pod can run cleanupJobState.
        let projectId: string | undefined;
        let featureName: string | undefined;
        let userEmail: string | undefined;
        try {
          const mapping = await this.stateStore.getJobMapping(jobId);
          if (mapping) {
            projectId = mapping.projectId;
            featureName = mapping.featureName;
            if (mapping.userContext) {
              userEmail = `${mapping.userContext.userId}@${mapping.userContext.organizationId}`;
            }
          }
        } catch { /* best-effort */ }

        await this.stateStore.publish(REDIS_CHANNELS.API_SERVER.JOB_STATUS_UPDATES, {
          type: 'failed',
          jobId,
          status: 'paused',
          projectId,
          featureName,
          userEmail,
          interruption: {
            reason: 'server_crash',
            message: 'Worker process crashed. You can resume this job.',
            canResume: true,
            timestamp: new Date().toISOString(),
          },
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        logger.error(`Failed to handle stalled job: ${jobId}`, { component: 'JobWorker', jobId }, err);
      }
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
            await this.killChildGracefully(childProcess, jobId);
            this.runningProcesses.delete(jobId);
            logger.info(`Job stopped successfully: ${jobId}`, { component: 'JobWorker', jobId });
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

    // Kill any existing child process for the same jobId.
    // Covers: (a) BullMQ stalled job re-processing after Mac sleep
    //         (b) Stop → Resume race condition
    const existingChild = this.runningProcesses.get(jobId);
    if (existingChild && existingChild.pid) {
      logger.warn(`Killing existing child for re-processed job: ${jobId} (PID: ${existingChild.pid})`, { component: 'JobWorker', jobId });
      try {
        await this.killChildGracefully(existingChild, jobId);
      } catch (err: any) {
        logger.warn(`Failed to kill existing child: ${err.message}`, { component: 'JobWorker', jobId });
      }
      this.runningProcesses.delete(jobId);
    }

    // Clear userStopped flag after killing old child (safe timing for Stop→Resume)
    await this.stateStore.clearUserStopped(jobId);

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
      
      // Guard: stalled handler may have already transitioned to 'paused' — don't overwrite
      const currentStatus = await this.stateStore.getJobStatus(jobId);
      if (currentStatus?.status === 'paused') {
        logger.warn(
          `Job ${jobId} already paused (likely by stalled handler) — skipping status update to '${jobStatus}'`,
          { component: 'JobWorker', jobId }
        );
        return result;
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

      // Guard: stalled handler may have already transitioned to 'paused'
      const currentStatus = await this.stateStore.getJobStatus(jobId);
      if (currentStatus?.status === 'paused') {
        logger.warn(
          `Job ${jobId} already paused (likely by stalled handler) — skipping status update to 'failed'`,
          { component: 'JobWorker', jobId }
        );
        throw error;
      }

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
   * - lockDuration: 5min — covers longest LLM call (thinking=true, ~2min) with margin
   * - Extension interval: 2.5min (lockDuration / 2)
   * - stalledInterval: 1min — detects actual dead workers within 3 min
   * - Dead Worker detection: ~3 min (1 expire + 1 check cycle + margin)
   */
  private async spawnJobProcess(
    job: Job<JobPayload>,
    payload: JobPayload
  ): Promise<{ success: boolean; error?: string; output?: any }> {
    const jobId = payload.jobId;

    // --- Timers: lock extension + cancellation polling ---
    // Both are cleaned up via cleanup() on child close/error.
    const timers: NodeJS.Timeout[] = [];
    const cleanup = () => timers.forEach(t => clearInterval(t));

    // --- Async setup (errors propagate normally to processJob catch) ---

    // Build environment variables for the job process
    const workspaceBase = payload.workspacePath
      || process.env.ANT_WORKSPACE_BASE_PATH
      || WorkspacePathResolver.getPhysicalWorkspacesPath();

    const workspaceResolver = new UnifiedWorkspaceResolver(workspaceBase);
    const projectPath = workspaceResolver.getProjectPath(payload.userContext, payload.projectId);
    const branchBase = readBranchBaseFromConfig(projectPath);
    const codebasePath = workspaceResolver.getCodebasePath(payload.userContext, payload.projectId, payload.feature);

    // For base branch jobs (learn), use projectPath as featurePath since there's no feature directory
    const isBaseBranchJob = isBaseBranch(payload.feature, branchBase);
    const featurePath = isBaseBranchJob
      ? projectPath
      : workspaceResolver.getFeaturePath(payload.userContext, payload.projectId, payload.feature);

    // CLI source/dist root for internal resource paths (templates, policies, etc.)
    const cliRoot = WorkspacePathResolver.getCliRoot();

    // Inject GitHub PAT-based credentials for private module access (go get, npm install)
    const credentialEnv = await this.getCredentialEnv(workspaceBase, payload.userContext, projectPath, codebasePath);

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      ...credentialEnv,
      ANT_JOB_ID: jobId,
      ANT_PROJECT_ID: payload.projectId,
      ANT_FEATURE: payload.feature,
      ANT_FEATURE_NAME: payload.feature,
      ANT_JOB_TYPE: payload.type,
      ANT_AGENT: payload.agent,
      ANT_MODE: payload.mode || 'generate',
      ANT_USER_ID: payload.userContext.userId,
      ANT_ORG_ID: payload.userContext.organizationId,
      ANT_REDIS_URL: this.options.redisUrl,
      ANT_BRANCH_BASE: branchBase,
      ANT_PROJECT_PATH: projectPath,
      ANT_FEATURE_PATH: featurePath,
      ANT_CODEBASE_PATH: codebasePath,
      ANT_CLI_ROOT: cliRoot,
      ANT_API_URL: process.env.ANT_API_URL || `http://localhost:${process.env.PORT || '4100'}`,
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
    const isDev = process.env.NODE_ENV === 'development';

    let runnerScript: string;
    let command: string;
    let args: string[];

    if (isDev) {
      runnerScript = path.resolve(__dirname, '../../composition/job-runner.ts');
      command = 'npx';
      args = ['tsx', runnerScript];
    } else {
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

    // --- Timer setup ---

    const MAX_CONSECUTIVE_LOCK_FAILURES = 2;
    let consecutiveLockFailures = 0;
    let lastExtensionTime = Date.now();

    timers.push(setInterval(async () => {
      const now = Date.now();
      const elapsed = now - lastExtensionTime;

      // Wall-clock gap detection: if elapsed > lockDuration, system was sleeping.
      // Lock is already expired in Redis — skip extend attempt and kill child immediately.
      if (elapsed > LOCK_DURATION) {
        logger.warn(
          `Wall-clock gap detected (${Math.round(elapsed / 1000)}s > lockDuration ${LOCK_DURATION / 1000}s) — lock expired during system sleep: ${jobId}`,
          { component: 'JobWorker', jobId }
        );
        cleanup();
        const childProcess = this.runningProcesses.get(jobId);
        if (childProcess?.pid) {
          this.killChildGracefully(childProcess, jobId).catch(() => {});
        }
        return;
      }

      lastExtensionTime = now;

      try {
        await job.extendLock(job.token!, LOCK_DURATION);
        consecutiveLockFailures = 0;
      } catch (error: any) {
        consecutiveLockFailures++;
        logger.warn(
          `Lock extension failed for job: ${jobId} (${consecutiveLockFailures}/${MAX_CONSECUTIVE_LOCK_FAILURES})`,
          { component: 'JobWorker', jobId }
        );

        if (consecutiveLockFailures >= MAX_CONSECUTIVE_LOCK_FAILURES) {
          logger.error(
            `Lock likely expired for job: ${jobId} — killing child to prevent "Missing lock" error`,
            { component: 'JobWorker', jobId }
          );
          cleanup();
          const childProcess = this.runningProcesses.get(jobId);
          if (childProcess?.pid) {
            this.killChildGracefully(childProcess, jobId).catch(() => {});
          }
        }
      }
    }, LOCK_EXTENSION_INTERVAL));

    // Cancellation polling — backup for pub/sub job:stop channel.
    // NOTE: Do NOT clear the isUserStopped flag here.
    // The RouteConfigurator's JOB_STATUS_UPDATES handler checks this flag
    // to skip duplicate cleanupJobState calls.
    timers.push(setInterval(async () => {
      const isStopped = await this.stateStore.isUserStopped(jobId);
      if (isStopped && child.pid) {
        cleanup();
        child.kill('SIGTERM');
      }
    }, CANCELLATION_POLL_INTERVAL));

    // --- Child lifecycle (event-based — wrapped in Promise) ---
    return new Promise<{ success: boolean; error?: string; output?: any }>((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', async (data: Buffer) => {
        const line = data.toString();
        stdout += line;

        console.log(`[job-runner:${jobId}] ${line.trim()}`);

        if (line.includes('PROGRESS:')) {
          try {
            const progressJson = line.split('PROGRESS:')[1].trim();
            const progress = JSON.parse(progressJson);
            await job.updateProgress(progress);
          } catch {
            // Ignore parse errors
          }
        }

        await this.stateStore.appendJobLog(jobId, {
          type: 'stdout',
          message: line,
          timestamp: new Date().toISOString()
        });
      });

      child.stderr?.on('data', async (data: Buffer) => {
        const line = data.toString();
        stderr += line;

        console.error(`[job-runner:${jobId}:stderr] ${line.trim()}`);

        await this.stateStore.appendJobLog(jobId, {
          type: 'stderr',
          message: line,
          timestamp: new Date().toISOString()
        });
      });

      child.on('close', (code: number | null) => {
        cleanup();
        logger.info(`Child process exited with code: ${code}`, { component: 'JobWorker', jobId });

        let parsedResult: any = { success: code === 0 };
        try {
          const resultMatch = stdout.match(/^RESULT:(\{.+\})$/m);
          if (resultMatch) {
            parsedResult = JSON.parse(resultMatch[1]);
          } else {
            const stdoutLen = stdout.length;
            const lastLines = stdout.split('\n').filter(Boolean).slice(-5).join(' | ');
            console.warn(`[JobWorker] RESULT regex no match | jobId=${jobId} | stdoutLen=${stdoutLen} | exitCode=${code} | lastLines: ${lastLines.substring(0, 300)}`);
          }
        } catch (parseErr: any) {
          console.warn(`[JobWorker] RESULT parse failed | jobId=${jobId} | error=${parseErr.message}`);
        }

        if (code === 0) {
          resolve(parsedResult);
        } else {
          logger.error(`Job runner failed: ${stderr || 'No stderr'}`, { component: 'JobWorker', jobId });
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
        cleanup();
        logger.error(`Failed to spawn job runner: ${err.message}`, { component: 'JobWorker', jobId }, err);
        reject(err);
      });
    });
  }

  /**
   * Read GitHub PAT from CredentialsStore and build env vars for private module access.
   * Returns empty object on any failure (safe no-op for projects without GitHub PAT).
   */
  private async getCredentialEnv(
    workspaceBase: string,
    userContext: { organizationId: string; userId: string },
    projectPath: string,
    codebasePath?: string
  ): Promise<Record<string, string>> {
    try {
      const store = new CredentialsStore(workspaceBase);
      const creds = await store.get<GitHubCredentials>(
        { organizationId: userContext.organizationId, userId: userContext.userId },
        'github'
      );
      const githubRepo = this.readGithubRepoFromConfig(projectPath);
      const credEnv = buildCredentialEnv(creds?.token || null, githubRepo, codebasePath);
      if (Object.keys(credEnv).length > 0) {
        logger.info('🔑 Injecting GitHub credentials for private module access', { component: 'JobWorker' });
      }
      return credEnv;
    } catch {
      return {};
    }
  }

  private readGithubRepoFromConfig(projectPath: string): string | null {
    try {
      const configPath = path.join(projectPath, 'config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        return config.githubRepo || null;
      }
    } catch { /* config not found or invalid */ }
    return null;
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
