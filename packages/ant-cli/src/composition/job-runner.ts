#!/usr/bin/env node
/**
 * Job Runner - Child Process Entry Point
 * 
 * This script is spawned by JobWorker to execute individual jobs.
 * It receives job parameters via environment variables and executes
 * the appropriate agent workflow via orchestrator.
 * 
 * Environment Variables:
 *   ANT_JOB_ID           - Job ID
 *   ANT_PROJECT_ID       - Project ID
 *   ANT_FEATURE          - Feature name
 *   ANT_JOB_TYPE         - Job type (code, design, learn)
 *   ANT_AGENT            - Agent type (architect, reviewer, planner, doc)
 *   ANT_MODE             - Execution mode (generate, refactor, explain)
 *   ANT_USER_ID          - User ID
 *   ANT_ORG_ID           - Organization ID
 *   ANT_OVERRIDE_DIRECTIVE - Override directive (optional)
 *   ANT_INPUT_FILE       - Input file path (optional)
 *   ANT_IS_RESUME        - Whether this is a resume (optional)
 *   ANT_ORIGINAL_JOB_ID  - Original job ID for resume (optional)
 *   ANT_REDIS_URL        - Redis URL for state updates
 *   ANT_CHAT_SOURCE      - Whether from chat (optional)
 * 
 * Output:
 *   - Progress updates via stdout: "PROGRESS:{json}"
 *   - Final result via stdout: "RESULT:{json}"
 *   - Logs via stdout/stderr
 * 
 * @see JobWorker.ts
 */

import 'dotenv/config';
import * as path from 'path';
import Redis from 'ioredis';
import { orchestrator } from './orchestrator';
import { UnifiedWorkspaceResolver } from '../core/config/WorkspacePathResolver';
import { initPartials } from '../periphery/adapters/prompt/FilePromptAdapter';
import { logger } from '../utils/logger';
import { handleGracefulShutdown } from './gracefulShutdown';
import { abortJob, isJobAborted } from './jobAbort';
import { REDIS_KEYS, REDIS_CHANNELS } from '../infrastructure/state/redisConstants';
import { RedisStateStore } from '../infrastructure/state/RedisStateStore';
import { createTLSOptions } from '../infrastructure/utils/redis';
import type { InterruptionReason, InterruptionDetails } from '../core/types/session';
import { buildInfrastructureInterruption } from '@ant/shared';
import { isPromptTooLongError } from '../core/utils/apiErrorClassify';

interface JobParams {
  jobId: string;
  projectId: string;
  feature: string;
  jobType: 'code' | 'design' | 'learn' | 'inline-ask' | 'visual';
  agent: 'architect' | 'reviewer' | 'planner' | 'doc' | 'creator';
  mode: 'generate' | 'refactor' | 'explain';
  userId: string;
  orgId: string;
  projectPath: string;    // Full project path (already resolved)
  featurePath: string;    // Full feature path (already resolved)
  overrideDirective?: string;
  inputFile?: string;
  isResume?: boolean;
  originalJobId?: string;
  skipTriage?: boolean;
  chatSource?: boolean;
  actionMetadata?: import('@ant/shared').ActionMetadata;
  /** chat SSOT §6 — pre-allocated turnId from /chat/user-message. */
  seedTurnId?: string;
}

function getJobParams(): JobParams {
  const required = ['ANT_JOB_ID', 'ANT_PROJECT_ID', 'ANT_FEATURE', 'ANT_JOB_TYPE', 'ANT_AGENT', 'ANT_USER_ID', 'ANT_ORG_ID', 'ANT_PROJECT_PATH', 'ANT_FEATURE_PATH'];
  
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
  
  return {
    jobId: process.env.ANT_JOB_ID!,
    projectId: process.env.ANT_PROJECT_ID!,
    feature: process.env.ANT_FEATURE!,
    jobType: process.env.ANT_JOB_TYPE as 'code' | 'design' | 'learn' | 'visual',
    agent: process.env.ANT_AGENT as 'architect' | 'reviewer' | 'planner' | 'doc' | 'creator',
    mode: (process.env.ANT_MODE || 'generate') as 'generate' | 'refactor' | 'explain',
    userId: process.env.ANT_USER_ID!,
    orgId: process.env.ANT_ORG_ID!,
    projectPath: process.env.ANT_PROJECT_PATH!,
    featurePath: process.env.ANT_FEATURE_PATH!,
    overrideDirective: process.env.ANT_OVERRIDE_DIRECTIVE,
    inputFile: process.env.ANT_INPUT_FILE,
    isResume: process.env.ANT_IS_RESUME === 'true',
    originalJobId: process.env.ANT_ORIGINAL_JOB_ID,
    chatSource: process.env.ANT_CHAT_SOURCE === 'true',
    skipTriage: process.env.ANT_SKIP_TRIAGE === 'true',
    actionMetadata: process.env.ANT_ACTION_METADATA ? (() => { try { return JSON.parse(process.env.ANT_ACTION_METADATA); } catch { return undefined; } })() : undefined,
    seedTurnId: process.env.ANT_SEED_TURN_ID,
  };
}

// Pre-established Redis connection for SIGTERM handler (avoids connection latency during shutdown)
let killReasonRedis: Redis | null = null;

// Redis SSOT subscriber for the user-stop signal. Owns a dedicated subscriber
// connection internally (RedisStateStore) so channel + JSON serialization match
// the publisher (POST /jobs/:id/stop).
let stopSignalStore: RedisStateStore | null = null;
let stopPollTimer: NodeJS.Timeout | null = null;

// Once-guard shared by the STOP-triggered self-SIGTERM and a real parent SIGTERM,
// so double signal delivery cannot run reportResult/exit twice.
let shutdownInitiated = false;

/**
 * Make this child observe the Redis stop SSOT directly (Unified Distributed
 * System Principle): the running job must honor a user stop even when no
 * external process holds its in-memory child handle (cloud replica / pod
 * restart / orphaned child). On stop we trip the AbortController (interrupts
 * the in-flight LLM stream) and self-raise SIGTERM — reusing the proven
 * terminal path (resolveKillReason → handleGracefulShutdown → reportResult →
 * exit 143) rather than duplicating it.
 */
async function watchUserStop(jobId: string): Promise<void> {
  const redisUrl = process.env.ANT_REDIS_URL;
  if (!redisUrl) return;

  const trigger = (source: string) => {
    if (shutdownInitiated) return;
    console.log(`[JobRunner] User-stop observed via ${source} — aborting job: ${jobId}`);
    abortJob();
    process.kill(process.pid, 'SIGTERM');
  };

  try {
    stopSignalStore = new RedisStateStore({ url: redisUrl, maxRetriesPerRequest: 1 });

    // Primary: pub/sub STOP signal.
    await stopSignalStore.subscribe(
      REDIS_CHANNELS.JOB_WORKER.STOP,
      (message: unknown) => {
        if ((message as { jobId?: string })?.jobId === jobId) trigger('pub/sub STOP');
      },
    );

    // Backup: poll the userStopped flag (covers a STOP published before this
    // subscription was live). Effective only because the flag is preserved
    // through the user_stopped finalize seal — see sealJobRedisState.
    stopPollTimer = setInterval(async () => {
      try {
        if (await stopSignalStore!.isUserStopped(jobId)) trigger('poll backup');
      } catch { /* best-effort */ }
    }, 2000);
    stopPollTimer.unref();
  } catch (err: any) {
    console.warn(`[JobRunner] Failed to wire user-stop watcher: ${err?.message}`);
  }
}

async function resolveKillReason(jobId: string): Promise<InterruptionReason> {
  if (!killReasonRedis) return 'server_crash';
  try {
    const key = `${REDIS_KEYS.JOB.KILL_REASON}${jobId}`;
    const raw = await Promise.race([
      killReasonRedis.get(key),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 100)),
    ]);
    if (raw) {
      const parsed = JSON.parse(raw);
      return (parsed.reason as InterruptionReason) || 'server_crash';
    }
  } catch { /* Redis unavailable = infrastructure kill */ }
  return 'server_crash';
}

function reportProgress(phase: string, message: string, percentage?: number): void {
  const progress = { phase, message, percentage, timestamp: new Date().toISOString() };
  console.log(`PROGRESS:${JSON.stringify(progress)}`);
}

function reportResult(success: boolean, output?: any, error?: string): void {
  const result = { success, output, error, timestamp: new Date().toISOString() };
  console.log(`RESULT:${JSON.stringify(result)}`);
}

async function runJob(params: JobParams): Promise<void> {
  logger.info(`Job runner started: ${params.jobId} (type: ${params.jobType}, agent: ${params.agent})`, { 
    component: 'JobRunner',
    jobId: params.jobId
  });
  
  reportProgress('starting', `Starting ${params.jobType} job with ${params.agent} agent`);
  
  const userContext = {
    userId: params.userId,
    organizationId: params.orgId,
  };
  
  try {
    // Create workspace resolver for cloud mode
    const workspaceResolver = new UnifiedWorkspaceResolver(process.env.ANT_WORKSPACE_BASE_PATH || process.cwd());
    
    // Use pre-resolved paths from environment variables
    const { projectPath, featurePath } = params;
    
    // Read directive from input file if provided
    let input = params.overrideDirective || '';
    if (params.inputFile) {
      try {
        const fs = await import('fs/promises');
        input = await fs.readFile(params.inputFile, 'utf-8');
      } catch (e) {
        logger.warn(`Could not read input file: ${params.inputFile}`, { component: 'JobRunner' });
      }
    }
    
    reportProgress('executing', `Running ${params.agent} ${params.jobType}...`);
    
    // Call orchestrator
    const result = await orchestrator({
      agent: params.agent,
      jobType: params.jobType,
      input,
      project: params.projectId,
      feature: params.feature,
      inputFile: params.inputFile,
      mode: params.mode,
      jobId: params.isResume ? params.originalJobId : params.jobId,
      featurePath,
      projectPath,
      workspaceResolver,
      userContext,
      overrideDirective: params.overrideDirective,
      chatSource: params.chatSource,
      skipTriage: params.skipTriage,
      actionMetadata: params.actionMetadata,
      isResume: params.isResume,
      seedTurnId: params.seedTurnId,
    });
    
    reportProgress('completed', 'Job completed successfully', 100);
    reportResult(true, result);
    
  } catch (error: any) {
    // User-stop abort: the LLM stream throws APIUserAbortError, which unwinds
    // here. Do NOT report process_crash / exit(1) — the SIGTERM handler
    // (raised by the STOP subscription) is the sole terminal authority and
    // will reportResult(user_stopped) + exit(143). Park so the main path can
    // never race it. The parked promise is reclaimed on process.exit.
    if (isJobAborted()) {
      logger.info(`Job aborted by user stop — yielding to shutdown handler: ${params.jobId}`, {
        component: 'JobRunner',
        jobId: params.jobId,
      });
      await new Promise<never>(() => {});
    }

    logger.error(`Job runner failed: ${params.jobId}`, {
      component: 'JobRunner',
      jobId: params.jobId
    }, error);

    // Deterministic "request too large" (prompt exceeds the model context
    // window) is NOT an infra crash and NOT resumable — resuming re-sends the
    // same oversized request. Fail explicitly with a clear, actionable reason
    // and no resume affordance (canResume:false → dismiss-only card).
    const promptTooLong = isPromptTooLongError(error);
    const interruption = promptTooLong
      ? {
          reason: 'api_error' as InterruptionReason,
          message:
            'The request is too large for the model context window (the assembled prompt exceeded the maximum). ' +
            'This usually means too many or too large reference files were selected. ' +
            'Reduce the selected references and start a new job.',
          timestamp: new Date().toISOString(),
          canResume: false,
        }
      : {
          reason: 'process_crash' as InterruptionReason,
          message: error.message || 'Unexpected error occurred.',
          timestamp: new Date().toISOString(),
          canResume: true,
        };

    reportProgress('failed', interruption.message);
    reportResult(false, {
      success: false,
      job: params.jobType,
      interruption,
    }, interruption.message);

    throw error;
  }
}

async function main(): Promise<void> {
  const params = getJobParams();

  // Pre-establish Redis connection for SIGTERM kill reason lookup
  const redisUrl = process.env.ANT_REDIS_URL;
  if (redisUrl) {
    try {
      killReasonRedis = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        connectTimeout: 3000,
        lazyConnect: false,
        ...createTLSOptions(redisUrl),
      });
      killReasonRedis.on('error', () => {}); // suppress unhandled connection errors
    } catch { /* best-effort — resolveKillReason will fallback to server_crash */ }
  }

  // Observe the Redis stop SSOT before running, so a user stop is honored even
  // when no external process holds this child's in-memory handle.
  await watchUserStop(params.jobId);

  const partialResult = await initPartials();
  if (partialResult.failed.length > 0) {
    console.error(`⛔ ${partialResult.failed.length} partial(s) failed to register`);
  }

  try {
    await runJob(params);
    
    // Ensure stdout is fully flushed before exiting.
    // process.exit() terminates immediately, dropping any data still queued
    // in libuv's write buffer. For large RESULT JSON (e.g. 28k+ chars of
    // generatedDocument), the pipe buffer can overflow and libuv queues the
    // remainder — which is then lost if we exit too soon.
    await new Promise<void>((resolve) => {
      process.stdout.write('', () => resolve());
    });
    process.exit(0);
    
  } catch (error: any) {
    console.error(`Job runner error: ${error.message}`);
    await new Promise<void>((resolve) => {
      process.stdout.write('', () => resolve());
    });
    process.exit(1);
  }
}

// ============================================
// SIGTERM Handler — Graceful Shutdown
// ============================================
// When SIGTERM is received, resolve the kill reason from Redis:
// - Key exists → Worker set it (user_stopped / server_crash / server_shutdown)
// - Key missing → infrastructure killed directly (K8s, OOMKill) → default server_crash
//
// Timing budget (worst case: stall handler, 2500ms grace):
//   resolveKillReason 100ms + gracefulShutdown 1800ms = 1900ms < 2500ms
//
// Output contract: After graceful shutdown completes (orchestrator pushes
// running tasks back as interrupted + checkpoint saved), emit a final
// `RESULT:{json}` line so JobWorker → BullMQ → RouteConfigurator can read
// the interruption reason and route to the correct lifecycle transition
// (finalize for user_stopped, pauseJob for the rest).
process.on('SIGTERM', async () => {
  // Once-guard: a STOP-triggered self-SIGTERM and a real parent SIGTERM can both
  // arrive — only the first runs the terminal report + exit.
  if (shutdownInitiated) return;
  shutdownInitiated = true;

  const jobId = process.env.ANT_JOB_ID || 'unknown';
  const reason = await resolveKillReason(jobId);

  if (stopPollTimer) clearInterval(stopPollTimer);

  const mem = process.memoryUsage();
  console.log(JSON.stringify({
    event: 'SIGTERM_RECEIVED',
    reason,
    jobId,
    uptimeSeconds: Math.round(process.uptime()),
    memoryMB: { rss: Math.round(mem.rss / 1048576), heap: Math.round(mem.heapUsed / 1048576) },
    timestamp: new Date().toISOString(),
  }));

  try {
    await handleGracefulShutdown(reason);
  } catch (error: any) {
    console.error(`[JobRunner] Graceful shutdown error:`, error?.message);
  }

  reportResult(false, {
    success: false,
    job: process.env.ANT_JOB_TYPE,
    interruption: buildSigtermInterruption(reason),
  });
  await new Promise<void>(resolve => process.stdout.write('', () => resolve()));

  killReasonRedis?.disconnect();
  stopSignalStore?.close().catch(() => { /* best-effort */ });
  console.log(`[JobRunner] Exiting with code 143 (SIGTERM, reason=${reason})`);
  process.exit(143);
});

/**
 * Build an `InterruptionDetails`-shaped object from a SIGTERM kill reason.
 * Mirrors the patterns used in `JobExecutionManager.analyzeFailureReason`,
 * `ServerLifecycleManager`, and `StaleJobRecovery` so downstream consumers
 * (RouteConfigurator → finalize/pauseJob, JobCleanupManager, ChatService
 * cancelled card) receive a consistent payload regardless of the kill path.
 *
 * `user_stopped` is a terminal (finalize) path with its own semantics. Every
 * other SIGTERM kill reason is an infrastructure interruption, so its
 * `canResume` MUST come from the single owner (`buildInfrastructureInterruption`)
 * which gates on `isMidGraphResumable(jobType)` — otherwise plan/visual jobs
 * would surface a false "resume" affordance after a server_shutdown / crash.
 */
function buildSigtermInterruption(reason: InterruptionReason): InterruptionDetails {
  if (reason === 'user_stopped') {
    return {
      reason,
      message: 'Task stopped by user',
      timestamp: new Date().toISOString(),
      canResume: true,
      metadata: { stoppedBy: 'user_action' },
    };
  }
  return buildInfrastructureInterruption(reason, process.env.ANT_JOB_TYPE);
}

// Run
main();
