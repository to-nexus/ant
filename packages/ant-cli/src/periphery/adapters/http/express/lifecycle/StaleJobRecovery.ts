/**
 * StaleJobRecovery
 *
 * Runs once on API Server startup to detect and clean up "orphaned" jobs
 * that were left in a running state due to a previous crash (SIGKILL, OOM, etc.).
 *
 * Multi-pod safe:
 *   - Global Redis lock ensures only ONE pod runs recovery at a time.
 *   - Per-job Redis locks prevent duplicate cleanup when recovery overlaps
 *     with stalled-event handlers on other pods.
 *
 * Recovery logic:
 *   1. Scan Redis for all jobs with status 'running'
 *   2. For each, check the real BullMQ queue state
 *   3. If BullMQ says the job is NOT active, mark it as interrupted
 *      so the UI can offer a "Resume" option on next load.
 *
 * Also scans BullMQ completed/failed jobs whose cleanup may have been missed
 * because the API Server was down when the Pub/Sub event fired.
 */

import { logger } from '../../../../../utils/logger';
import { getInfrastructureFactory } from '../../../../../infrastructure/adapters/InfrastructureFactory';
import { BullMQJobQueue } from '../../../../../infrastructure/queue/BullMQJobQueue';
import type { InterruptionDetails } from '../../../../../core/types';
import type { JobCleanupManager } from '../managers/JobCleanupManager';

const COMPONENT = 'StaleJobRecovery';
const RECOVERY_LOCK_KEY = 'ant:lock:stale-job-recovery';
const RECOVERY_LOCK_TTL = 60; // seconds — generous to cover full scan
const PER_JOB_LOCK_PREFIX = 'ant:recovery:job:';
const PER_JOB_LOCK_TTL = 120; // seconds

export async function recoverStaleJobs(
  cleanupJobState: JobCleanupManager['cleanupJobState']
): Promise<void> {
  const factory = getInfrastructureFactory();
  const stateStore = factory.getStateStore();

  // Multi-pod guard: only one pod should run recovery at a time.
  const acquired = await stateStore.acquireLock(RECOVERY_LOCK_KEY, RECOVERY_LOCK_TTL);
  if (!acquired) {
    logger.info(`Another pod is running stale job recovery — skipping`, { component: COMPONENT });
    return;
  }

  try {
    const jobQueue = factory.getJobQueue() as BullMQJobQueue;

    // --- Phase 1: Orphaned "running" jobs in Redis ---
    const runningJobs = await stateStore.findJobsByStatus('running');

    if (runningJobs.length === 0) {
      logger.info(`No stale running jobs found`, { component: COMPONENT });
    } else {
      logger.info(`Found ${runningJobs.length} job(s) with status 'running' — verifying against BullMQ`, { component: COMPONENT });
    }

    for (const job of runningJobs) {
      try {
        const queueStatus = await jobQueue.getStatus(job.jobId);

        // Only skip jobs that are genuinely queued (waiting to be picked up).
        // Do NOT skip "running" (BullMQ active) jobs: after a server restart
        // the BullMQ lock may still be valid (up to lockDuration = 30s)
        // even though no worker is processing the job.  Treat them as stale.
        // If a worker IS alive in a distributed setup, its normal completion
        // flow will overwrite the 'paused' status set here.
        if (queueStatus === 'queued') {
          logger.info(`Job ${job.jobId} is queued in BullMQ, skipping recovery`, { component: COMPONENT });
          continue;
        }

        // Per-job idempotency: stalled handler on another pod may already be processing this job
        const jobLock = await stateStore.acquireLock(`${PER_JOB_LOCK_PREFIX}${job.jobId}`, PER_JOB_LOCK_TTL);
        if (!jobLock) {
          logger.info(`Job ${job.jobId} recovery already in progress on another pod`, { component: COMPONENT });
          continue;
        }

        // Re-check after acquiring lock: status may have changed between scan and lock acquisition
        const freshStatus = await stateStore.getJobStatus(job.jobId);
        if (freshStatus && freshStatus.status !== 'running' && freshStatus.status !== 'queued') {
          logger.info(`Job ${job.jobId} already resolved (status=${freshStatus.status}), skipping`, { component: COMPONENT });
          continue;
        }

        logger.info(`Orphaned job detected: ${job.jobId} (redis=running, bullmq=${queueStatus})`, {
          component: COMPONENT,
          jobId: job.jobId,
          projectId: job.projectId,
          featureName: job.featureName,
        });

        const mapping = await stateStore.getJobMapping(job.jobId);
        const jobType = (mapping?.jobType || job.type || 'code') as 'design' | 'code' | 'learn' | 'plan' | 'visual';

        const interruption: InterruptionDetails = {
          reason: 'server_crash',
          message: 'Server was terminated unexpectedly. You can resume this job.',
          canResume: true,
          timestamp: new Date().toISOString(),
        };

        await cleanupJobState(
          job.jobId,
          job.projectId,
          job.featureName,
          interruption,
          jobType,
          job.userContext,
        );

        await stateStore.updateJobStatus(job.jobId, {
          status: 'paused',
          completedAt: new Date().toISOString(),
          error: 'Server crashed — job interrupted',
        });

        // Best-effort BullMQ cleanup: with lockDuration=30s the lock
        // has likely already expired by startup time.
        try {
          const bullJob = await jobQueue.getJob(job.jobId);
          if (bullJob) await bullJob.remove();
          logger.info(`Removed stale BullMQ job ${job.jobId}`, { component: COMPONENT });
        } catch {
          logger.info(`BullMQ job ${job.jobId} still locked, will expire shortly`, { component: COMPONENT });
        }

        logger.info(`Recovered orphaned job ${job.jobId} → interrupted (resumable)`, { component: COMPONENT });
      } catch (err) {
        logger.warn(`Failed to recover job ${job.jobId}`, { component: COMPONENT }, err);
      }
    }

    // --- Phase 3: Missed BullMQ completions (Pub/Sub message lost) ---
    await recoverMissedCompletions(jobQueue, stateStore, cleanupJobState);
  } catch (err) {
    logger.error(`Stale job recovery failed`, { component: COMPONENT }, err);
  } finally {
    await stateStore.releaseLock(RECOVERY_LOCK_KEY).catch(() => {});
  }
}

/**
 * Scan BullMQ completed/failed jobs and run cleanupJobState for any whose
 * Redis status still says 'running' or 'queued' (meaning the Pub/Sub
 * completion event was lost because the API Server was down).
 */
async function recoverMissedCompletions(
  jobQueue: BullMQJobQueue,
  stateStore: ReturnType<ReturnType<typeof getInfrastructureFactory>['getStateStore']>,
  cleanupJobState: JobCleanupManager['cleanupJobState'],
): Promise<void> {
  try {
    const completedJobs = await jobQueue.getJobsByState('completed', 50);
    const failedJobs = await jobQueue.getJobsByState('failed', 50);
    const allDoneJobs = [...completedJobs, ...failedJobs];

    if (allDoneJobs.length === 0) return;

    let recovered = 0;
    for (const bullJob of allDoneJobs) {
      if (!bullJob.id) continue;
      try {
        const redisStatus = await stateStore.getJobStatus(bullJob.id);
        if (!redisStatus) continue;

        const isStale = redisStatus.status === 'running' || redisStatus.status === 'queued';
        if (!isStale) continue;

        // Per-job idempotency lock
        const jobLock = await stateStore.acquireLock(`${PER_JOB_LOCK_PREFIX}${bullJob.id}`, PER_JOB_LOCK_TTL);
        if (!jobLock) continue;

        // Re-check after lock: another handler may have resolved this between scan and lock
        const freshStatus = await stateStore.getJobStatus(bullJob.id);
        if (!freshStatus || (freshStatus.status !== 'running' && freshStatus.status !== 'queued')) continue;

        const payload = bullJob.data;
        const mapping = await stateStore.getJobMapping(bullJob.id);
        const jobType = (mapping?.jobType || payload?.type || 'code') as 'design' | 'code' | 'learn' | 'plan' | 'visual';
        const projectId = mapping?.projectId || payload?.projectId;
        const featureName = mapping?.featureName || payload?.feature;

        if (!projectId || !featureName) continue;

        const bullState = await bullJob.getState();
        const isFailed = bullState === 'failed';

        const interruption: InterruptionDetails | undefined = isFailed
          ? {
              reason: 'server_crash' as const,
              message: 'Job failed while server was down. You can resume this job.',
              canResume: true,
              timestamp: new Date().toISOString(),
            }
          : undefined;

        const userContext = mapping?.userContext || payload?.userContext;
        await cleanupJobState(bullJob.id, projectId, featureName, interruption, jobType, userContext);

        const finalStatus = isFailed ? 'failed' : 'completed';
        await stateStore.updateJobStatus(bullJob.id, {
          status: finalStatus as any,
          completedAt: new Date().toISOString(),
        });

        recovered++;
        logger.info(`Recovered missed completion: ${bullJob.id} → ${finalStatus}`, { component: COMPONENT });
      } catch (err) {
        logger.warn(`Failed to recover missed completion for ${bullJob.id}`, { component: COMPONENT }, err);
      }
    }

    if (recovered > 0) {
      logger.info(`Recovered ${recovered} missed BullMQ completion(s)`, { component: COMPONENT });
    }
  } catch (err) {
    logger.warn(`Missed completion recovery failed`, { component: COMPONENT }, err);
  }
}
