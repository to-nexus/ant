import type Redis from 'ioredis';
import { REDIS_KEYS } from '../infrastructure/state/redisConstants';
import { buildInfrastructureInterruption } from '@ant/shared';
import type { InterruptionReason, InterruptionDetails } from '../core/types/session';

/**
 * Resolve the kill reason for a job whose child process has received SIGTERM.
 *
 * Reaching a SIGTERM handler PROVES the process was asked to terminate
 * gracefully (signal 15). A true crash — SIGKILL (signal 9), OOMKill, K8s
 * force-kill — is uncatchable and never runs a signal handler, so it cannot
 * be observed here; those are labeled `server_crash` externally by
 * `StaleJobRecovery` on the next server's reconcile. Therefore the truthful
 * fallback WHEN no more-specific reason is available is `server_shutdown`
 * (graceful deploy/drain), NOT `server_crash`.
 *
 * The worker normally writes a specific reason (`user_stopped` /
 * `worker_stalled` / `lock_expired` / `system_sleep` / `server_shutdown`) to
 * `${JOB.KILL_REASON}${jobId}` before forwarding SIGTERM; we prefer it when
 * present. During a rolling deploy the process group is SIGTERM'd nearly
 * simultaneously, so that write can lose the race — the `server_shutdown`
 * default keeps the label accurate (graceful, resumable) instead of raising a
 * false defect-class `server_crash`.
 */
export async function resolveKillReason(
  jobId: string,
  redis: Redis | null | undefined,
): Promise<InterruptionReason> {
  if (!redis) return 'server_shutdown';
  try {
    const key = `${REDIS_KEYS.JOB.KILL_REASON}${jobId}`;
    const raw = await Promise.race([
      redis.get(key),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 100)),
    ]);
    if (raw) {
      const parsed = JSON.parse(raw);
      return (parsed.reason as InterruptionReason) || 'server_shutdown';
    }
  } catch { /* Redis unreadable within the SIGTERM budget — still a graceful signal */ }
  return 'server_shutdown';
}

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
export function buildSigtermInterruption(
  reason: InterruptionReason,
  jobType: string | undefined,
): InterruptionDetails {
  if (reason === 'user_stopped') {
    return {
      reason,
      message: 'Task stopped by user',
      timestamp: new Date().toISOString(),
      canResume: true,
      metadata: { stoppedBy: 'user_action' },
    };
  }
  return buildInfrastructureInterruption(reason, jobType);
}
