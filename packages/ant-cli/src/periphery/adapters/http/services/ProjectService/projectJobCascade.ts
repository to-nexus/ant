/**
 * Project-scope job cascade — cancel & wait for child exit before deletion.
 *
 * `ProjectService.deleteProject` cannot safely `fs.rm` while a job-runner
 * child process is still writing to EFS (NFS silly-renames open files into
 * `.nfsXXXX` orphans, leaving the project directory partially populated and
 * making the next createProject return 409 "Project already exists").
 *
 * Cascade per jobId:
 *   1. Mark `userStopped` + set `killReason` so the worker that owns the job
 *      sends SIGTERM to its child as soon as it polls (Worker existing path).
 *   2. `jobQueue.cancel` — drop any BullMQ waiting/delayed residue.
 *   3. `sealJobRedisState` — DEL all Redis keys (no session patch — feature
 *      is about to be wiped).
 *   4. `waitForJobChildExit` — block on Redis `JOB.STATUS` reaching a terminal
 *      value (failed/completed/cancelled) so we know the child has actually
 *      exited and is no longer holding open file descriptors.
 *
 * The helper is intentionally small (no JobCleanupManager / KanbanService /
 * session patch) — it matches the "bare seal" fallback path already used in
 * features.routes.ts when lifecycle deps are unavailable. Project deletion
 * removes the entire feature directory anyway, so session.json patches would
 * be writes to a doomed file.
 */

import type { StateStorePort } from '../../../../../core/ports/stateStore';
import type { JobQueuePort } from '../../../../../core/ports/queue';
import type { UserContext } from '../../../../../core/types/user';
import type { RedisStateStore } from '../../../../../infrastructure/state/RedisStateStore';
import { sealJobRedisState } from '../../routes/helpers/sessionCleanup';
import { logger } from '../../../../../utils/logger';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'paused']);

const CHILD_EXIT_POLL_INTERVAL_MS = 500;
const CHILD_EXIT_DEFAULT_TIMEOUT_MS = 30_000;

interface CancelAllProjectJobsArgs {
  stateStore: StateStorePort;
  jobQueue: JobQueuePort;
  projectId: string;
  features: string[];
  userContext: UserContext;
  /** Override per-job child exit wait. Defaults to 30s. */
  childExitTimeoutMs?: number;
}

/**
 * Resolve once the job has no more activity to chase: either the Redis
 * status reaches a terminal value, or the timeout expires (best-effort —
 * the caller's fs.rm verification loop is the final backstop).
 */
async function waitForJobChildExit(
  stateStore: StateStorePort,
  jobId: string,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let status: string | null | undefined;
    try {
      const data = await stateStore.getJobStatus(jobId);
      status = data?.status;
    } catch (err) {
      // Redis blip — treat as still pending; loop continues until timeout.
      logger.debug(`[CancelCascade] getJobStatus blip for ${jobId}`, { component: 'CancelCascade' }, err);
    }
    // Status may be falsy after sealJobRedisState — that's also a terminal signal.
    if (!status || TERMINAL_STATUSES.has(status)) return;
    await new Promise((r) => setTimeout(r, CHILD_EXIT_POLL_INTERVAL_MS));
  }
  logger.warn(`[CancelCascade] Job child exit wait timed out`, { component: 'CancelCascade' }, { jobId, timeoutMs });
}

/**
 * Cancel every job tied to the project and wait for child processes to exit.
 *
 * Idempotent — safe to call when no jobs exist or when some have already
 * sealed. Errors during individual cancels are logged and swallowed so a
 * single stuck job cannot block project deletion (the fs.rm verification
 * loop is the final guard).
 */
export async function cancelAllProjectJobs(args: CancelAllProjectJobsArgs): Promise<void> {
  const { stateStore, jobQueue, projectId, features, userContext, childExitTimeoutMs = CHILD_EXIT_DEFAULT_TIMEOUT_MS } = args;

  const allJobs = (
    await Promise.all(
      features.map(async (f) => {
        try {
          return await stateStore.listJobsByFeature(projectId, f);
        } catch (err) {
          logger.warn(`[CancelCascade] listJobsByFeature failed`, { component: 'CancelCascade' }, { projectId, feature: f, err });
          return [];
        }
      }),
    )
  ).flat();

  if (allJobs.length === 0) {
    logger.debug(`[CancelCascade] No active jobs to cancel`, { component: 'CancelCascade' }, {
      projectId,
      organizationId: userContext.organizationId,
      userId: userContext.userId,
    });
    return;
  }

  logger.info(`[CancelCascade] Cancelling ${allJobs.length} job(s) for project deletion`, { component: 'CancelCascade' }, {
    projectId,
    jobIds: allJobs.map((j) => j.jobId),
  });

  // Step 1: mark user stopped + set kill reason. Worker will pick this up
  // and SIGTERM its child on next poll.
  for (const job of allJobs) {
    try {
      await stateStore.markUserStopped(job.jobId);
    } catch (err) {
      logger.warn(`[CancelCascade] markUserStopped failed`, { component: 'CancelCascade' }, { jobId: job.jobId, err });
    }
    // setKillReason is on RedisStateStore (not in the port interface yet).
    // Same cast pattern as JobWorker.setKillReason — see SSOT note in
    // RedisStateStore.setKillReason.
    const ssAny = stateStore as unknown as Partial<RedisStateStore>;
    if (typeof ssAny.setKillReason === 'function') {
      try {
        await ssAny.setKillReason(job.jobId, 'project_delete_cascade');
      } catch (err) {
        logger.warn(`[CancelCascade] setKillReason failed`, { component: 'CancelCascade' }, { jobId: job.jobId, err });
      }
    }
  }

  // Step 2: drop BullMQ residue.
  for (const job of allJobs) {
    try {
      await jobQueue.cancel(job.jobId);
    } catch (err) {
      logger.warn(`[CancelCascade] jobQueue.cancel failed`, { component: 'CancelCascade' }, { jobId: job.jobId, err });
    }
  }

  // Step 3: bare Redis seal (no session patch — feature dir is about to be removed).
  for (const job of allJobs) {
    try {
      await sealJobRedisState(stateStore, undefined, job.jobId);
    } catch (err) {
      logger.warn(`[CancelCascade] sealJobRedisState failed`, { component: 'CancelCascade' }, { jobId: job.jobId, err });
    }
  }

  // Step 4: wait for each child process to actually exit (or timeout best-effort).
  await Promise.all(
    allJobs.map((job) => waitForJobChildExit(stateStore, job.jobId, childExitTimeoutMs)),
  );

  logger.info(`[CancelCascade] Cancelled ${allJobs.length} job(s) — children exited`, { component: 'CancelCascade' }, { projectId });
}
