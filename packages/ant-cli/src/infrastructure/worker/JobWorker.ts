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
import { monitorEventLoopDelay } from 'perf_hooks';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { StateStorePort } from '../../core/ports/stateStore';
import { JobPayload, JobProgress } from '../../core/ports/queue';
import { RedisStateStore } from '../state/RedisStateStore';
import { REDIS_CHANNELS } from '../state/redisConstants';
import { LOCK_DURATION, LOCK_EXTENSION_INTERVAL, STALLED_INTERVAL, CANCELLATION_POLL_INTERVAL } from '../queue/constants';
import { logger } from '../../utils/logger';
import { holdIdleSleepAssertion } from './sleepAssertion';
import { UnifiedWorkspaceResolver, WorkspacePathResolver } from '../../core/config/WorkspacePathResolver';
import { readBranchBaseFromConfig, isBaseBranch } from '../../core/utils/branchUtils';
import { parseRedisUrl } from '../utils/redis';
import { CredentialsStore, GitHubCredentials, buildCredentialEnv } from '../../utils/userConfig';
import type { InterruptionReason } from '@ant/shared';
import { readCgroupMemoryLimit, readCgroupMemoryUsage } from '../../periphery/system/cgroupLimits';
import * as fs from 'fs';

// ESM: derive __dirname from import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const QUEUE_NAME = 'ant-jobs';
const DEFAULT_CONCURRENCY = 2;

/**
 * Interruption reasons that represent a graceful, infrastructure-driven stop
 * — the child process was terminated on purpose (user, lock, sleep, shutdown,
 * stalled worker) and the non-zero exit code is expected. We log these at
 * `info` level and skip the stderr dump because:
 *   1. The child has already reported the structured `interruption.reason` via
 *      its `RESULT:` payload, so the cause is unambiguous.
 *   2. Each stderr line was already streamed to the console via the
 *      `[job-runner:…:stderr]` prefix.
 *
 * Reasons NOT in this list (`process_crash`, `server_crash`, `api_error`,
 * `unknown`, etc.) fall through to the legacy `Job runner failed` branch
 * with the full stderr dump, because those signal a defect / unexpected
 * failure where the captured stderr is the primary debugging signal.
 */
const GRACEFUL_INTERRUPTION_REASONS: ReadonlySet<InterruptionReason> = new Set([
  'user_stopped',
  'worker_stalled',
  'server_shutdown',
  'system_sleep',
  'lock_expired',
]);

/**
 * Classify a child exit for diagnostics (RCA `tight-drafting-lever`). A cgroup
 * OOM-kill arrives as `signal=SIGKILL, code=null` and leaves NO JS heap-OOM
 * error, so it was previously logged only as the silent `code: null`. Naming it
 * turns the silent failure into an actionable error line. Pure — unit-tested.
 */
export function classifyChildExit(
  code: number | null,
  signal: NodeJS.Signals | null,
): { level: 'error' | 'warn'; message: string } | null {
  if (code !== null || !signal) return null; // normal/known-code exit — existing logs cover it
  if (signal === 'SIGKILL') {
    return {
      level: 'error',
      message:
        'Child terminated by SIGKILL (code=null) — probable OOM / external kill ' +
        '(cgroup SIGKILL leaves no JS heap-OOM error); check pod memory limits',
    };
  }
  return { level: 'warn', message: `Child terminated by signal=${signal} (code=null)` };
}

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
  private eventLoopWatchdog: NodeJS.Timeout | null = null;

  constructor(options: JobWorkerOptions) {
    this.options = options;

    // Create state store connection
    this.stateStore = new RedisStateStore({ url: options.redisUrl });

    logger.info(`JobWorker initialized for queue: ${options.queueName || QUEUE_NAME}`, {
      component: 'JobWorker'
    });
  }

  /**
   * Record kill reason in Redis before sending SIGTERM to a child.
   * Best-effort — never blocks the kill flow on failure.
   */
  private async setKillReason(jobId: string, reason: string): Promise<void> {
    try {
      await (this.stateStore as RedisStateStore).setKillReason(jobId, reason);
    } catch {
      // Best-effort — Redis failure must not delay kill
    }
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

      // POISON FLAG — set BEFORE killing the child so the orchestrator's
      // onCheckpoint short-circuits its atomicWrite even on the API-server-pod-
      // first-acquires-lock path where this worker pod never reaches the kill
      // branch below. Idempotent via acquireLock NX; failure tolerated.
      await this.stateStore
        .acquireLock(`ant:job-poisoned:${jobId}`, 600)
        .catch(() => false);

      // Kill the child process for this stalled job (if running in this pod).
      // AWAIT the kill so any in-flight onCheckpoint write completes (or is
      // killed) BEFORE we publish the lifecycle event. Without this, a
      // checkpoint queued during the 2500ms SIGTERM grace can land AFTER
      // cleanupJobState's projection and resurrect un-interrupted runningTasks
      // — reproducing the "3 in_progress" Kanban flip on refresh.
      const stalledChild = this.runningProcesses.get(jobId);
      if (stalledChild && stalledChild.pid) {
        logger.warn(`Killing stalled child process: ${jobId} (PID: ${stalledChild.pid})`, { component: 'JobWorker', jobId });
        await this.setKillReason(jobId, 'worker_stalled');
        try {
          await this.killChildGracefully(stalledChild, jobId, 2500);
        } catch (err) {
          logger.warn(`killChildGracefully threw during stall handling: ${jobId}`, { component: 'JobWorker', jobId }, err);
        }
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
            reason: 'worker_stalled',
            message: 'Worker process became unresponsive. You can resume this job.',
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

    // Process-wide event-loop watchdog. Surfaces shared-loop pauses (heavy
    // sync work in any concurrent job, foreign sync block, GC) independent
    // of per-job state. The previous incident (2026-05-18 two-job same-pod
    // stall) had no per-job late-extension warning because the loop was
    // blocked entirely; a process-level watchdog catches that case.
    this.startEventLoopWatchdog();

    logger.info(`JobWorker started: queue=${queueName}, concurrency=${this.options.concurrency || DEFAULT_CONCURRENCY}`, {
      component: 'JobWorker'
    });
  }

  /**
   * Process-wide event-loop lag monitor. Logs whenever the loop is delayed
   * by more than 1 second — independent of any job. Critical for diagnosing
   * the "two jobs stalled on same pod within 1 minute" failure mode where
   * per-job lock-extension timers all stop firing at once.
   */
  private startEventLoopWatchdog(): void {
    let lastTick = Date.now();
    const TICK_INTERVAL = 500;
    const LAG_THRESHOLD = 1000;
    this.eventLoopWatchdog = setInterval(() => {
      const now = Date.now();
      const lag = now - lastTick - TICK_INTERVAL;
      if (lag > LAG_THRESHOLD) {
        const activeJobs = Array.from(this.runningProcesses.keys());
        logger.warn(
          `Event-loop lag ${lag}ms (active jobs: [${activeJobs.join(', ')}])`,
          { component: 'JobWorker' }
        );
      }
      lastTick = now;
    }, TICK_INTERVAL);
    this.eventLoopWatchdog.unref();
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
            await this.setKillReason(jobId, 'user_stopped');
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
      // Update status to running.
      // 'running' is a progress signal, not a terminal transition, so it's
      // safe to write directly here. Terminal transitions
      // (completed/failed/paused) are handled exclusively by
      // finalize/pauseJob via the RouteConfigurator JOB_STATUS_UPDATES
      // subscriber — JobWorker never writes terminal status directly.
      await this.stateStore.updateJobStatus(jobId, {
        status: 'running',
        startedAt: new Date().toISOString()
      });

      // Pre-spawn cancellation guard. If POST /jobs/:id/stop already ran
      // before the BullMQ worker dequeued this job, finalize has already
      // recorded the terminal status — we just bail out without spawning.
      const isStopped = await this.stateStore.isUserStopped(jobId);
      if (isStopped) {
        logger.info(`Job cancelled by user (pre-spawn): ${jobId}`, { component: 'JobWorker', jobId });
        return { cancelled: true };
      }

      // Execute job in child process. The result (success/error/output) is
      // returned to BullMQ; the queueEvents.completed/failed listeners on
      // BullMQJobQueue then publish JOB_STATUS_UPDATES, which the
      // RouteConfigurator handler routes to finalize (terminal) or pauseJob
      // (resumable interruption). Status writes flow through that single
      // SSOT, never from here.
      return await this.spawnJobProcess(job, payload);

    } catch (error: any) {
      logger.error(`Job execution error: ${jobId}`, { component: 'JobWorker', jobId }, error);
      // Re-throwing surfaces the error to BullMQ as a 'failed' event,
      // which BullMQJobQueue forwards to RouteConfigurator → finalize.
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
    // Additional teardown callbacks registered after the child spawn (e.g.
    // `loopMon.disable()`). Declared up-here so `cleanup` can be a single
    // `const` referenced by both `setInterval` callbacks below and child
    // event handlers further down — without rebinding.
    const extraCleanups: Array<() => void> = [];
    const cleanup = () => {
      timers.forEach(t => clearInterval(t));
      for (const fn of extraCleanups) {
        try { fn(); } catch { /* idempotent */ }
      }
    };

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

    // Phase 3-12 — denylist test-harness env vars so a mistakenly-set
    // `ANT_SCENARIO_*` in the worker process cannot leak into production
    // child processes. These vars change runtime behaviour (e.g.
    // `ANT_SCENARIO_PRESERVE_RETRIES=1` keeps a seeded retry counter).
    const sanitizedProcessEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith('ANT_SCENARIO_')) continue;
      if (typeof value === 'string') sanitizedProcessEnv[key] = value;
    }

    const env: Record<string, string> = {
      ...sanitizedProcessEnv,
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
    if (payload.actionMetadata) {
      env.ANT_ACTION_METADATA = JSON.stringify(payload.actionMetadata);
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
    if (payload.seedTurnId) {
      // chat SSOT §6 — pre-allocated turnId from /chat/user-message;
      // the orchestrator will pass this to recordUserTurn so the durable
      // user_turn shares the same id as the optimistic SSE broadcast.
      env.ANT_SEED_TURN_ID = payload.seedTurnId;
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

    // job-runner emits strictly newline-delimited UTF-8 (`RESULT:{json}` /
    // `PROGRESS:{json}` / logger lines). Decoding at the stream layer drops
    // the per-chunk `Buffer.toString()` from the hot path.
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');

    logger.info(`Child process spawned with PID: ${child.pid}`, { component: 'JobWorker', jobId });

    this.runningProcesses.set(jobId, child);

    // Hold an OS idle-sleep assertion for this child's lifetime so the host
    // doesn't suspend mid-job (which would lapse the lock → `system_sleep`
    // teardown). No-op off macOS/Windows; the watchdog auto-exits with the
    // child. Kept OUT of runningProcesses — it must stay invisible to the
    // lock-extension / stalled / kill logic and the stdout line protocol.
    if (child.pid) {
      const sleepGuard = holdIdleSleepAssertion(child.pid);
      if (sleepGuard) extraCleanups.push(() => sleepGuard.kill());
    }

    // --- Diagnostic counters (Change 5) ---
    // Owned by spawnJobProcess so they survive the entire child lifecycle and
    // are read both by the lock-extension late-warning and by the close-time
    // RESULT-miss diagnostics. Captured by closure in handlers below.
    const loopMon = monitorEventLoopDelay({ resolution: 50 });
    loopMon.enable();
    extraCleanups.push(() => loopMon.disable());
    let lastExtensionSuccess = Date.now();
    let peakPendingStdout = 0;
    let linesProcessed = 0;
    let droppedBytesTotal = 0;

    // --- Timer setup ---

    const MAX_CONSECUTIVE_LOCK_FAILURES = 2;
    let consecutiveLockFailures = 0;
    let lastExtensionTime = Date.now();

    // Memory-pressure pre-warning (RCA `tight-drafting-lever`): a cgroup OOM-kill
    // is silent (SIGKILL, no JS error) AND it kills the parent's lock-renewal
    // timer, so nothing logs the cause post-mortem. Sampling cgroup memory on
    // THIS timer emits the only signal that ships to logs BEFORE the kill.
    // `undefined` limit (non-cgroup host) → guard skips, zero cost.
    const cgroupMemLimit = readCgroupMemoryLimit();
    const MEMORY_PRESSURE_FRACTION = 0.85;
    let memoryPressureWarned = false;

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
          this.setKillReason(jobId, 'system_sleep').then(() =>
            this.killChildGracefully(childProcess, jobId)
          ).catch(() => {});
        }
        return;
      }

      // Starvation early-warning. If the timer is firing >25% late, the parent
      // event loop is being saturated (heavy IPC, sync ops blocking the loop).
      // Surface this BEFORE elapsed reaches LOCK_DURATION so we can correlate
      // with the actual saturation source. The 2026-05-18 incident's worker
      // logs had NEITHER this warning NOR the "Lock extension failed" warning,
      // meaning the timer stopped firing entirely — the new loop_p99/loop_max
      // + lastSuccess fields below let the next stall distinguish "loop
      // blocked" from "Redis hung against this pod".
      if (elapsed > LOCK_EXTENSION_INTERVAL * 1.25) {
        const loopP99ms = Math.round(loopMon.percentile(99) / 1e6);
        const loopMaxMs = Math.round(loopMon.max / 1e6);
        const msSinceLastSuccess = now - lastExtensionSuccess;
        logger.warn(
          `Lock-extension timer late by ${elapsed - LOCK_EXTENSION_INTERVAL}ms (interval=${LOCK_EXTENSION_INTERVAL}ms, ` +
          `loop_p99=${loopP99ms}ms, loop_max=${loopMaxMs}ms, peakPendingStdout=${peakPendingStdout}, ` +
          `linesProcessed=${linesProcessed}, droppedStdoutBytes=${droppedBytesTotal}, ` +
          `msSinceLastExtendSuccess=${msSinceLastSuccess}): ${jobId}`,
          { component: 'JobWorker', jobId }
        );
      }

      if (cgroupMemLimit !== undefined) {
        const used = readCgroupMemoryUsage();
        if (used !== undefined && used >= cgroupMemLimit * MEMORY_PRESSURE_FRACTION) {
          if (!memoryPressureWarned) {
            memoryPressureWarned = true;
            const pct = Math.round((used / cgroupMemLimit) * 100);
            logger.warn(
              `Cgroup memory pressure: used=${Math.round(used / 1048576)}/${Math.round(cgroupMemLimit / 1048576)}MiB (${pct}%) — ` +
              `OOM-kill risk; correlate with loop_p99 / lock-extension-late warnings: ${jobId}`,
              { component: 'JobWorker', jobId }
            );
          }
        } else {
          memoryPressureWarned = false; // re-arm once pressure subsides
        }
      }

      lastExtensionTime = now;

      try {
        await job.extendLock(job.token!, LOCK_DURATION);
        consecutiveLockFailures = 0;
        lastExtensionSuccess = Date.now();
        // Reset histogram so the NEXT cycle's percentiles reflect only the
        // window since the last successful extend — keeps the late-warning
        // diagnostic correlated with the cycle that triggered it.
        try { loopMon.reset(); } catch { /* histogram disabled — race in cleanup */ }
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
            this.setKillReason(jobId, 'lock_expired').then(() =>
              this.killChildGracefully(childProcess, jobId)
            ).catch(() => {});
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
        await this.setKillReason(jobId, 'user_stopped');
        child.kill('SIGTERM');
      }
    }, CANCELLATION_POLL_INTERVAL));

    // --- Child lifecycle (event-based — wrapped in Promise) ---
    return new Promise<{ success: boolean; error?: string; output?: any }>((resolve, reject) => {
      // Line-buffered parser. `child.stdout.on('data', …)` is chunk-based
      // (no newline guarantee), so RESULT lines that straddle chunk
      // boundaries would slip past a chunk-local regex. We accumulate the
      // trailing partial line in `pending*` and process only completed lines.
      //
      // Pathological-line guard (Change 1, 2026-05-18 RCA). Without a cap,
      // a single very-long line with no newline (giant tool dump, LLM probe
      // blob, jest progress with carriage-returns) makes `pendingStdout +=`
      // grow indefinitely while `lastIndexOf('\n')` re-scans the entire
      // buffer per chunk, forcing V8 cons-string flattening and inducing
      // multi-second GC pauses on the parent's event loop.
      //
      // 10 MB cap leaves ~300× headroom over the documented RESULT JSON
      // size ("28k+ chars" per job-runner.ts). On overflow, drop bytes
      // until the next newline rather than synthesizing a truncated
      // "line" — a synthesized prefix that begins with `RESULT:` would
      // feed garbage to `JSON.parse` and silently lose the real RESULT.
      const PENDING_STDOUT_HARD_CAP = 10 * 1024 * 1024;
      let pendingStdout = '';
      let pendingStderr = '';
      let pendingStdoutOverflowed = false;
      let droppedBytesThisOverflow = 0;

      // RESULT is a single line (`RESULT:{...}\n`). Capture into one
      // variable instead of accumulating all stdout — RESULT-sized memory
      // only.
      let resultLine: string | null = null;

      // 64 KB tail ring for fallback diagnostics when RESULT regex doesn't
      // match. O(1) eviction (Change 3): advance `tailHead` rather than
      // `Array.shift()`; rebuild via slice only when head crosses the
      // midpoint. The original `shift()` loop was O(M²) for chunks that
      // pushed many small lines past the cap.
      const STDOUT_TAIL_MAX = 64 * 1024;
      const tailRing: string[] = [];
      let tailHead = 0;
      let tailBytes = 0;
      const pushStdoutTail = (s: string) => {
        tailRing.push(s);
        tailBytes += s.length;
        while (tailBytes > STDOUT_TAIL_MAX && tailRing.length - tailHead > 1) {
          tailBytes -= tailRing[tailHead].length;
          // Null out so V8 can reclaim the string immediately rather than
          // waiting for the periodic splice rebuild.
          tailRing[tailHead] = '';
          tailHead++;
        }
        // Amortized rebuild: when more than half the ring is dead slots,
        // compact in one O(N) splice. Keeps per-push cost O(1).
        if (tailHead > tailRing.length / 2) {
          tailRing.splice(0, tailHead);
          tailHead = 0;
        }
      };
      const readTail = (): string => {
        let out = '';
        for (let i = tailHead; i < tailRing.length; i++) out += tailRing[i];
        return out;
      };

      // stderr stays accumulated — terminal-failure debugging surface. 1MB
      // hard cap is a safety net against runaway stderr loops; normal
      // stderr is KB-scale.
      const STDERR_HARD_CAP = 1 * 1024 * 1024;
      let stderr = '';
      let stderrTruncated = false;

      // --- Line processing + batched console.log (Change 2) ---
      //
      // The previous handler did N synchronous `console.log` calls per
      // stdout chunk (one per line). For a chunk carrying thousands of
      // lines (e.g. concurrent parallel-orchestrator progress, jest output
      // surfacing through a tool wrapper) this monopolized the event loop
      // long enough to starve the lock-extension `setInterval` callback —
      // the documented 2026-05-18 same-pod-same-minute double stall.
      //
      // We now (a) parse RESULT/PROGRESS per-line (cheap), (b) emit ONE
      // `console.log` per slice with `[job-runner:${jobId}] ` re-prefixed
      // on each line via `join`, and (c) pump the line queue with
      // `setImmediate` so a 50 000-line burst gives the event loop a
      // chance to service the lock-extension timer between slices.
      //
      // `setImmediate` is required (not `queueMicrotask` / `nextTick`):
      // those run inside the current phase and never yield to the Timers
      // phase where `setInterval` lock-extension fires. `setImmediate`
      // queues into the next iteration's Check phase, so the loop
      // completes a full revolution before the next pump iteration.
      //
      // A single shared `lineQueue` (not per-chunk closures) preserves
      // console.log ordering across chunks — if chunk B arrives while
      // chunk A is still pumping, B's lines append to the same queue
      // and emit AFTER A's remaining slices.
      const YIELD_LINE_THRESHOLD = 200;
      const STDOUT_PREFIX = `[job-runner:${jobId}] `;
      const lineQueue: string[] = [];
      let pumping = false;

      const processStdoutLineNoLog = (line: string) => {
        pushStdoutTail(line + '\n');
        if (line.startsWith('RESULT:')) {
          resultLine = line.substring('RESULT:'.length);
        }
        if (line.startsWith('PROGRESS:')) {
          try {
            const progressJson = line.substring('PROGRESS:'.length).trim();
            const progress = JSON.parse(progressJson);
            // Fire-and-forget — `updateProgress` is BullMQ progress metrics;
            // awaiting on the hot path is what was starving the lock-
            // extension timer and producing the worker_stalled state.
            job.updateProgress(progress).catch(() => { /* ignore */ });
          } catch { /* ignore parse errors */ }
        }
      };

      const handleSlice = (lines: string[]) => {
        if (lines.length === 0) return;
        // Single console.log per slice. `join` re-prefixes every line so
        // CloudWatch full-text search against `[job-runner:${jobId}]`
        // continues to match each individual line.
        console.log(STDOUT_PREFIX + lines.join('\n' + STDOUT_PREFIX));
        for (let i = 0; i < lines.length; i++) processStdoutLineNoLog(lines[i]);
        linesProcessed += lines.length;
      };

      const pump = () => {
        const slice = lineQueue.splice(0, YIELD_LINE_THRESHOLD);
        if (slice.length === 0) {
          pumping = false;
          return;
        }
        handleSlice(slice);
        if (lineQueue.length > 0) {
          setImmediate(pump);
        } else {
          pumping = false;
        }
      };

      const drainQueueSync = () => {
        // Used by `close` to ensure RESULT (queued just before exit) is
        // parsed before we resolve. Synchronous — we're already terminal.
        while (lineQueue.length > 0) {
          handleSlice(lineQueue.splice(0, YIELD_LINE_THRESHOLD));
        }
      };

      // Helper: log + reset the overflow-drop counter when a newline ends
      // the dropped span. Centralized so both the overflow-recovery and the
      // same-chunk-newline branches stay consistent.
      const recordOverflowDrop = () => {
        droppedBytesTotal += droppedBytesThisOverflow;
        logger.warn(
          `Dropped ${droppedBytesThisOverflow}B of stdout (line > ${PENDING_STDOUT_HARD_CAP}B cap): ${jobId}`,
          { component: 'JobWorker', jobId }
        );
        droppedBytesThisOverflow = 0;
        pendingStdoutOverflowed = false;
      };

      child.stdout?.on('data', (chunk: string) => {
        // === Phase 1: handle overflow recovery if needed ===
        // Loop because a chunk could complete an overflow AND immediately
        // start another overflow if the remainder after newline is itself
        // huge (defensive — pipe chunks are normally <= 64 KB so this is
        // mostly theoretical).
        let cursor = 0;
        if (pendingStdoutOverflowed) {
          const nlIdx = chunk.indexOf('\n', cursor);
          if (nlIdx === -1) {
            droppedBytesThisOverflow += chunk.length - cursor;
            return;
          }
          droppedBytesThisOverflow += nlIdx - cursor;
          recordOverflowDrop();
          cursor = nlIdx + 1;
        }

        // === Phase 2: append remaining chunk into pendingStdout with cap ===
        const remaining = cursor === 0 ? chunk : chunk.substring(cursor);
        if (pendingStdout.length + remaining.length > PENDING_STDOUT_HARD_CAP) {
          // The combined size would exceed the cap. The partial line that
          // pendingStdout represents has no newline (by invariant), so the
          // overflow boundary is somewhere inside `remaining`. Find the
          // first newline in `remaining`; everything before it gets
          // dropped, everything after it starts a fresh accumulation.
          const origPendingLength = pendingStdout.length;
          pendingStdout = '';
          pendingStdoutOverflowed = true;
          const nlIdx = remaining.indexOf('\n');
          if (nlIdx !== -1) {
            droppedBytesThisOverflow = origPendingLength + nlIdx;
            recordOverflowDrop();
            // Defensive: if the post-newline remainder is itself >cap,
            // re-enter overflow. Pipe chunks are normally <= 64 KB so
            // this is unreachable in practice — keeps the invariant
            // ("pendingStdout never exceeds cap") airtight regardless.
            const postNewline = remaining.substring(nlIdx + 1);
            if (postNewline.length > PENDING_STDOUT_HARD_CAP) {
              pendingStdoutOverflowed = true;
              droppedBytesThisOverflow = postNewline.length;
              return;
            }
            pendingStdout = postNewline;
          } else {
            droppedBytesThisOverflow = origPendingLength + remaining.length;
            return;
          }
        } else {
          pendingStdout += remaining;
        }

        // === Phase 3: extract completed lines, queue them, kick pump ===
        if (pendingStdout.length > peakPendingStdout) {
          peakPendingStdout = pendingStdout.length;
        }

        const newlineIdx = pendingStdout.lastIndexOf('\n');
        if (newlineIdx === -1) return; // No complete line yet.

        const completed = pendingStdout.substring(0, newlineIdx);
        pendingStdout = pendingStdout.substring(newlineIdx + 1);
        const lines = completed.split('\n');

        for (let i = 0; i < lines.length; i++) lineQueue.push(lines[i]);
        if (!pumping) {
          pumping = true;
          setImmediate(pump);
        }
      });

      child.stderr?.on('data', (chunk: string) => {
        if (!stderrTruncated) {
          if (stderr.length + chunk.length <= STDERR_HARD_CAP) {
            stderr += chunk;
          } else {
            const room = Math.max(0, STDERR_HARD_CAP - stderr.length);
            stderr += chunk.substring(0, room);
            stderr += '\n…[stderr truncated at 1MB hard cap]…\n';
            stderrTruncated = true;
          }
        }

        pendingStderr += chunk;
        const newlineIdx = pendingStderr.lastIndexOf('\n');
        if (newlineIdx === -1) return;
        const completed = pendingStderr.substring(0, newlineIdx);
        pendingStderr = pendingStderr.substring(newlineIdx + 1);
        for (const line of completed.split('\n')) {
          console.error(`[job-runner:${jobId}:stderr] ${line}`);
        }
      });

      child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
        // Drain any lines queued but not yet pumped, so RESULT (queued
        // just before exit) is parsed before we resolve.
        drainQueueSync();
        // Flush trailing partial lines (child can exit without final
        // newline). Only safe when NOT in overflow mode — overflow's
        // partial bytes were a pathological-line fragment we already
        // discarded.
        if (pendingStdout.length > 0 && !pendingStdoutOverflowed) {
          handleSlice([pendingStdout]);
        }
        if (pendingStderr.length > 0) console.error(`[job-runner:${jobId}:stderr] ${pendingStderr}`);

        cleanup();
        logger.info(`Child process exited with code: ${code}`, { component: 'JobWorker', jobId });

        // Name a signal-kill (SIGKILL+code=null = probable cgroup OOM) before the
        // resolve branching — pure diagnostics, does not alter control flow.
        const exitClass = classifyChildExit(code, signal);
        if (exitClass) {
          logger[exitClass.level](`${exitClass.message}: ${jobId}`, { component: 'JobWorker', jobId });
        }

        let parsedResult: any = { success: code === 0 };
        try {
          if (resultLine) {
            parsedResult = JSON.parse(resultLine);
          } else {
            const tail = readTail();
            const lastLines = tail.split('\n').filter(Boolean).slice(-5).join(' | ');
            logger.warn(
              `RESULT regex no match | jobId=${jobId} | tailBytes=${tailBytes} | exitCode=${code} | lastLines: ${lastLines.substring(0, 300)}`,
              { component: 'JobWorker', jobId }
            );
          }
        } catch (parseErr: any) {
          logger.warn(
            `RESULT parse failed | jobId=${jobId} | error=${parseErr.message}`,
            { component: 'JobWorker', jobId }
          );
        }

        if (code === 0) {
          resolve(parsedResult);
          return;
        }

        // Graceful interruption — child emitted a structured RESULT whose
        // `interruption.reason` is in the GRACEFUL_INTERRUPTION_REASONS
        // whitelist (user_stopped, worker_stalled, server_shutdown,
        // system_sleep, lock_expired). Log at info-level and skip the
        // stderr dump; re-emitting accumulated stderr on top of an
        // `error`-level "Job runner failed" line is what made user-stopped
        // jobs look like crashes (e.g. the `oval-looking-booth` log noise
        // from `[Decompose Validation]` warnings tailing a SIGTERM exit).
        //
        // Defective interruptions (`process_crash`, `server_crash`,
        // `api_error`, `unknown`, ...) fall through to the failure branch
        // so the stderr trace remains the primary debugging signal.
        const interruption =
          parsedResult.output?.interruption ?? parsedResult.interruption;
        const reason = interruption?.reason as InterruptionReason | undefined;
        if (reason && GRACEFUL_INTERRUPTION_REASONS.has(reason)) {
          logger.info(
            `Job runner interrupted (reason=${reason}, exitCode=${code})`,
            { component: 'JobWorker', jobId }
          );
          resolve(parsedResult);
          return;
        }

        logger.error(
          `Job runner failed (exitCode=${code}${signal ? `, signal=${signal}` : ''}${reason ? `, reason=${reason}` : ''}): ${stderr || 'No stderr'}`,
          { component: 'JobWorker', jobId }
        );
        if (parsedResult.output) {
          resolve(parsedResult);
        } else {
          resolve({
            success: false,
            error: stderr || `Process exited with code ${code}`
          });
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
    if (this.eventLoopWatchdog) {
      clearInterval(this.eventLoopWatchdog);
      this.eventLoopWatchdog = null;
    }
    const activeJobs = Array.from(this.runningProcesses.keys());
    logger.warn(`JobWorker shutting down — active jobs: [${activeJobs.join(', ')}]`, { component: 'JobWorker' });

    // Set kill reasons in parallel before sending SIGTERM
    await Promise.all(activeJobs.map(jid => this.setKillReason(jid, 'server_shutdown')));

    for (const [jobId, process] of this.runningProcesses) {
      logger.info(`Terminating job process: ${jobId} (reason=server_shutdown)`, { component: 'JobWorker', jobId });
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
