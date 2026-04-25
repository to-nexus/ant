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

export async function pauseJob(deps: PauseJobDeps, args: PauseJobArgs): Promise<void> {
  const { jobId, projectId, featureName, jobType, userContext, interruption } = args;

  logger.info(`pauseJob: ${jobId} (reason=${interruption.reason})`, {
    component: COMPONENT,
    jobId,
    projectId,
    featureName,
  });

  await deps.cleanupJobState(jobId, projectId, featureName, interruption, jobType, userContext);

  const stateStore = getInfrastructureFactory().getStateStore();
  // updateJobStatus is null-safe: if the status key was already evicted
  // (e.g. via a concurrent seal on another pod) this becomes a no-op
  // rather than resurrecting a sealed record.
  await stateStore.updateJobStatus(jobId, {
    status: 'paused',
    completedAt: new Date().toISOString(),
    error: interruption.message,
  });
}
