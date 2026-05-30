/**
 * Scoped job cancel cascade — generic helper used by project deletion and
 * feature deletion to safely cancel jobs and wait for child process exit
 * before `fs.rm`.
 *
 * `cancelScopedJobs(jobs, ctx)` is the SSOT helper: callers (project /
 * feature deletion) pre-filter `jobs[]` to their scope and the helper
 * applies the 4-step cascade uniformly. `cancelAllProjectJobs` is now a
 * thin wrapper that flattens `listJobsByFeature` for every feature in the
 * project and delegates.
 *
 * Cascade per jobId (uniform across scopes):
 *   1. Mark `userStopped` + set `killReason` so the worker that owns the job
 *      sends SIGTERM to its child as soon as it polls.
 *   2. `jobQueue.cancel` — drop any BullMQ waiting/delayed residue.
 *   3. `sealJobRedisState` — DEL all Redis keys (no session patch — the
 *      target directory is about to be wiped).
 *   4. `waitForJobChildExit` — block on Redis `JOB.STATUS` reaching a
 *      terminal value so we know the child has actually exited and is no
 *      longer holding open file descriptors (NFS silly-rename guard).
 */

import type { StateStorePort, JobStatusData } from '../../../../../core/ports/stateStore';
import type { JobQueuePort } from '../../../../../core/ports/queue';
import type { UserContext } from '../../../../../core/types/user';
import type { RedisStateStore } from '../../../../../infrastructure/state/RedisStateStore';
import { sealJobRedisState } from '../../routes/helpers/sessionCleanup';
import { logger } from '../../../../../utils/logger';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'paused']);

const CHILD_EXIT_POLL_INTERVAL_MS = 500;
const CHILD_EXIT_DEFAULT_TIMEOUT_MS = 30_000;

export interface CancelScopedJobsArgs {
  stateStore: StateStorePort;
  jobQueue: JobQueuePort;
  /** Caller-filtered job list (project-wide or feature-scoped). */
  jobs: JobStatusData[];
  /** Human-readable scope label for logs (e.g. `project: foo`, `feature: foo/bar`). */
  scope: string;
  /** `RedisStateStore.setKillReason` value (e.g. `project_delete_cascade`). */
  killReason: string;
  userContext: UserContext;
  /** Override per-job child exit wait. Defaults to 30s. */
  childExitTimeoutMs?: number;
}

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
 * Generic scoped cancel cascade. Idempotent — safe to call with `jobs=[]`.
 * Errors during individual cancels are logged and swallowed so a single
 * stuck job cannot block deletion (the fs.rm verification loop is the
 * final guard).
 */
export async function cancelScopedJobs(args: CancelScopedJobsArgs): Promise<void> {
  const {
    stateStore,
    jobQueue,
    jobs,
    scope,
    killReason,
    userContext,
    childExitTimeoutMs = CHILD_EXIT_DEFAULT_TIMEOUT_MS,
  } = args;

  if (jobs.length === 0) {
    logger.debug(`[CancelCascade] No active jobs to cancel`, { component: 'CancelCascade' }, {
      scope,
      organizationId: userContext.organizationId,
      userId: userContext.userId,
    });
    return;
  }

  logger.info(`[CancelCascade] Cancelling ${jobs.length} job(s) for ${scope}`, { component: 'CancelCascade' }, {
    scope,
    jobIds: jobs.map((j) => j.jobId),
  });

  // Step 1: mark user stopped + set kill reason. Worker will pick this up
  // and SIGTERM its child on next poll.
  for (const job of jobs) {
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
        await ssAny.setKillReason(job.jobId, killReason);
      } catch (err) {
        logger.warn(`[CancelCascade] setKillReason failed`, { component: 'CancelCascade' }, { jobId: job.jobId, err });
      }
    }
  }

  // Step 2: drop BullMQ residue.
  for (const job of jobs) {
    try {
      await jobQueue.cancel(job.jobId);
    } catch (err) {
      logger.warn(`[CancelCascade] jobQueue.cancel failed`, { component: 'CancelCascade' }, { jobId: job.jobId, err });
    }
  }

  // Step 3: bare Redis seal (no session patch — directory is about to be removed).
  for (const job of jobs) {
    try {
      await sealJobRedisState(stateStore, undefined, job.jobId);
    } catch (err) {
      logger.warn(`[CancelCascade] sealJobRedisState failed`, { component: 'CancelCascade' }, { jobId: job.jobId, err });
    }
  }

  // Step 4: wait for each child process to actually exit (or timeout best-effort).
  await Promise.all(
    jobs.map((job) => waitForJobChildExit(stateStore, job.jobId, childExitTimeoutMs)),
  );

  logger.info(`[CancelCascade] Cancelled ${jobs.length} job(s) — children exited`, { component: 'CancelCascade' }, { scope });
}

/**
 * Cancel every job tied to the project and wait for child processes to exit.
 * Thin wrapper over `cancelScopedJobs` — collects feature jobs via
 * `listJobsByFeature` and delegates.
 */
export async function cancelAllProjectJobs(args: CancelAllProjectJobsArgs): Promise<void> {
  const { stateStore, jobQueue, projectId, features, userContext, childExitTimeoutMs } = args;

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

  return cancelScopedJobs({
    stateStore,
    jobQueue,
    jobs: allJobs,
    scope: `project: ${projectId}`,
    killReason: 'project_delete_cascade',
    userContext,
    childExitTimeoutMs,
  });
}
