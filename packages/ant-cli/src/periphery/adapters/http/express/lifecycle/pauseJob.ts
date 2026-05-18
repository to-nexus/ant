/**
 * pauseJob — the canonical SSOT entry point for transitioning a job to a
 * **resumable paused state**. Companion to `finalizeTerminalJob` (terminal
 * transitions that seal Redis).
 *
 * Flow:
 *   1. `cleanupJobState(interruption)` — persists interruption details into
 *      the session file, finalizes the streaming chat message, broadcasts
 *      the final Kanban snapshot, appends the paused run to `runs[]`.
 *   2. `updateJobStatus('paused')` — flips the Redis status to `paused`
 *      so `listJobsByFeature` classifies it as a resumable live job.
 *   3. Redis keys (status / taskQueue / workflow / mapping / userStopped /
 *      logs / killReason / jobsByFeature SET) are **preserved** — this is
 *      the key difference from seal: the paused job is expected to resume
 *      on the same jobId via `/resume`, and the Redis state is the worker
 *      restoration source.
 *
 * Use when a job should still be resumable: `/stop` is NOT one of these
 * paths (stop is treated as terminal under this refactor — use
 * `finalizeTerminalJob`). Valid paused callers:
 *   - `StaleJobRecovery` Phase 1 (server_crash): interruption = server_crash
 *   - `ServerLifecycleManager.saveAllRunningJobs` (graceful shutdown):
 *     interruption = server_shutdown
 *   - `RouteConfigurator JOB_STATUS_UPDATES` handler when the worker
 *     returned with a non-user-stopped interruption (recursion_limit,
 *     api_error, verification_failed, etc.)
 *   - `BullMQJobQueue stalled` handler (worker_stalled) — currently
 *     writes status='paused' directly; can optionally migrate here.
 */

import type { InterruptionDetails } from '../../../../../core/types';
import type { UserContext } from '../../../../../core/types/user';
import { getInfrastructureFactory } from '../../../../../infrastructure/adapters/InfrastructureFactory';
import { logger } from '../../../../../utils/logger';
import type { JobCleanupManager } from '../managers/JobCleanupManager';

const COMPONENT = 'PauseJob';
const LOCK_TTL_SECONDS = 120;

export interface PauseJobArgs {
  jobId: string;
  projectId: string;
  featureName: string;
  jobType: 'code' | 'design' | 'learn' | 'plan' | 'visual';
  userContext?: UserContext;
  interruption: InterruptionDetails;
}

export interface PauseJobDeps {
  cleanupJobState: JobCleanupManager['cleanupJobState'];
}

/**
 * Entry-level idempotency: chat SSOT §8 mandates a `ant:job-pause:{id}`
 * SET-NX lock so that concurrent pause sources (StaleJobRecovery,
 * BullMQ stalled handler, ServerLifecycleManager, RouteConfigurator
 * JOB_STATUS_UPDATES, …) cannot all run `cleanupJobState` and emit
 * duplicate cancelled cards.
 *
 * The lock is held for 120s and released by the resume paths
 * (`/jobs/:id/resume`, `/continue`, `/decompose-choice proceed`) so a
 * resumed job can pause again later.
 */
export async function pauseJob(deps: PauseJobDeps, args: PauseJobArgs): Promise<void> {
  const { jobId, projectId, featureName, jobType, userContext, interruption } = args;

  const stateStore = getInfrastructureFactory().getStateStore();
  const lockKey = `ant:job-pause:${jobId}`;
  const acquired = await stateStore.acquireLock(lockKey, LOCK_TTL_SECONDS);
  if (!acquired) {
    logger.debug(
      `pauseJob skipped — another pause in progress (jobId=${jobId})`,
      { component: COMPONENT, jobId },
    );
    return;
  }

  logger.info(`pauseJob: ${jobId} (reason=${interruption.reason})`, {
    component: COMPONENT,
    jobId,
    projectId,
    featureName,
  });

  await deps.cleanupJobState(jobId, projectId, featureName, interruption, jobType, userContext);

  // updateJobStatus is null-safe: if the status key was already evicted
  // (e.g. via a concurrent seal on another pod) this becomes a no-op
  // rather than resurrecting a sealed record.
  await stateStore.updateJobStatus(jobId, {
    status: 'paused',
    completedAt: new Date().toISOString(),
    error: interruption.message,
  });

  // Release the poison flag now that cleanup has projected the final state
  // into the session file. The next resume cycle must let the orchestrator's
  // onCheckpoint write again. Idempotent — already-released is a no-op.
  await stateStore.releaseLock(`ant:job-poisoned:${jobId}`).catch(() => {});
}
