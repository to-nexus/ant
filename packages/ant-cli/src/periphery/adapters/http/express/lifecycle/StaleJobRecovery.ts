/**
 * StaleJobRecovery
 *
 * Runs once on API Server startup to reconcile the three lifecycle stores
 * (session file / Redis / BullMQ) that may have drifted while the server
 * was down. Three phases, all gated by a single global Redis lock:
 *
 *   Phase 1 — Orphaned "running" jobs in Redis:
 *     Scan Redis for `status='running'`, cross-check BullMQ. If BullMQ is
 *     not actively running the job, it was killed (SIGKILL, OOM, server
 *     crash). Transition to `paused` via `pauseJob(server_crash)` so the
 *     UI can offer a Resume button.
 *
 *   Phase 1b — Paused jobs missing their cancel/resume chat card:
 *     Scan Redis for `status='paused'`. A pause projection ran, so the job
 *     is resumable, but the durable chat "cancelled" card may never have
 *     been emitted — e.g. a resume wiped the Redis `turnId` anchor and a
 *     second interruption hit `no turn anchor` (slow-earning-heron RCA), or
 *     the emit crashed mid-flight. Detect "uncarded" via the absence of the
 *     `ant:chat:cancelled-emitted:job:{id}` NX flag (the definitive
 *     one-successful-emit-per-job bit) and re-drive `pauseJob(server_crash)`
 *     — idempotent via the pause lock + the card NX guard — so the missing
 *     card is emitted and `state.interruption` is (re)persisted. This closes
 *     the read-side KanbanService self-heal loop (board healed but chat card
 *     absent forever). Fix 1 (RouteConfigurator turnId preservation) prevents
 *     the anchor loss going forward; this repairs jobs already stranded.
 *
 *   Phase 2 — Missed BullMQ completions (Pub/Sub message lost):
 *     Scan BullMQ completed/failed, and for any whose Redis status still
 *     says 'running' or 'queued' (meaning the completion Pub/Sub event was
 *     dropped because the API Server was down), drive them through
 *     `finalizeTerminalJob` — same SSOT entry point used by normal
 *     completions.
 *
 *   Phase 3 — Orphan terminal records (seal missed):
 *     Scan the `ant:index:jobsByFeature:*` SET index. For each jobId:
 *       - Status key gone → srem the stale index entry.
 *       - Status is terminal (completed/failed) → seal was missed (e.g.
 *         server crashed between `updateJobStatus(terminal)` and the
 *         subsequent `sealJobRedisState`). Run `finalizeTerminalJob` to
 *         make the invariant whole.
 *       - Status is running / paused → leave for Phase 1.
 *
 * Multi-pod safe:
 *   - Global Redis lock ensures only ONE pod runs recovery at a time.
 *   - Per-job Redis locks prevent duplicate cleanup when recovery overlaps
 *     with stalled-event handlers on other pods.
 *   - `finalizeTerminalJob` and `pauseJob` each own their own entry-level
 *     idempotency locks (`ant:job-finalize:{id}` / `ant:job-pause:{id}`),
 *     so concurrent recovery + live events cannot both run cleanupJobState
 *     and emit duplicate cancelled cards.
 */

import { logger } from '../../../../../utils/logger';
import { getInfrastructureFactory } from '../../../../../infrastructure/adapters/InfrastructureFactory';
import { BullMQJobQueue } from '../../../../../infrastructure/queue/BullMQJobQueue';
import type { InterruptionDetails } from '../../../../../core/types';
import { buildInfrastructureInterruption } from '@ant/shared';
import type { JobCleanupManager } from '../managers/JobCleanupManager';
import type { JobStateTracker } from '../managers/JobStateTracker';
import type { KanbanService } from '../../services';
import { finalizeTerminalJob } from './finalizeTerminalJob';
import { pauseJob } from './pauseJob';

const COMPONENT = 'StaleJobRecovery';
const RECOVERY_LOCK_KEY = 'ant:lock:stale-job-recovery';
const RECOVERY_LOCK_TTL = 60; // seconds — generous to cover full scan
const PER_JOB_LOCK_PREFIX = 'ant:recovery:job:';
const PER_JOB_LOCK_TTL = 120; // seconds

export interface StaleJobRecoveryDeps {
  cleanupJobState: JobCleanupManager['cleanupJobState'];
  stateTracker: JobStateTracker;
  kanbanService?: KanbanService;
}

export async function recoverStaleJobs(deps: StaleJobRecoveryDeps): Promise<void> {
  const factory = getInfrastructureFactory();
  const stateStore = factory.getStateStore();

  const acquired = await stateStore.acquireLock(RECOVERY_LOCK_KEY, RECOVERY_LOCK_TTL);
  if (!acquired) {
    logger.info(`Another pod is running stale job recovery — skipping`, { component: COMPONENT });
    return;
  }

  try {
    const jobQueue = factory.getJobQueue() as BullMQJobQueue;

    // --- Phase 1: Orphaned "running" jobs in Redis → pause via SSOT ---
    await recoverOrphanedRunningJobs(jobQueue, stateStore, deps);

    // --- Phase 1b: Paused jobs missing their cancel/resume chat card ---
    await recoverUncardedPausedJobs(stateStore, deps);

    // --- Phase 2: Missed BullMQ completions (Pub/Sub message lost) ---
    await recoverMissedCompletions(jobQueue, stateStore, deps);

    // --- Phase 3: Orphan terminal records in jobsByFeature index ---
    await recoverOrphanTerminalIndexEntries(stateStore, deps);
  } catch (err) {
    logger.error(`Stale job recovery failed`, { component: COMPONENT }, err);
  } finally {
    await stateStore.releaseLock(RECOVERY_LOCK_KEY).catch(() => {});
  }
}

/**
 * Phase 1 — Redis `status='running'` with no active BullMQ counterpart
 * means the worker crashed mid-execution. Transition to `paused` via
 * `pauseJob(server_crash)` so the UI can offer Resume.
 */
async function recoverOrphanedRunningJobs(
  jobQueue: BullMQJobQueue,
  stateStore: ReturnType<ReturnType<typeof getInfrastructureFactory>['getStateStore']>,
  deps: StaleJobRecoveryDeps,
): Promise<void> {
  const runningJobs = await stateStore.findJobsByStatus('running');
  if (runningJobs.length === 0) {
    logger.info(`No stale running jobs found`, { component: COMPONENT });
    return;
  }

  logger.info(
    `Found ${runningJobs.length} job(s) with status 'running' — verifying against BullMQ`,
    { component: COMPONENT },
  );

  for (const job of runningJobs) {
    try {
      const queueStatus = await jobQueue.getStatus(job.jobId);

      // Only skip jobs that are genuinely queued (waiting to be picked up).
      // Do NOT skip "running" (BullMQ active) jobs: after a server restart
      // the BullMQ lock may still be valid (up to lockDuration = 30s) even
      // though no worker is processing the job. Treat them as stale. If a
      // worker IS alive in a distributed setup, its normal completion flow
      // will overwrite the 'paused' status set here.
      if (queueStatus === 'queued') {
        logger.info(`Job ${job.jobId} is queued in BullMQ, skipping recovery`, { component: COMPONENT });
        continue;
      }

      // Liveness guard: if the BullMQ lock is still fresh, a worker is actively
      // extending it on another pod — the job is alive, not orphaned. Pausing it
      // here produces a false "server terminated / resume" card that the worker's
      // normal completion then overwrites (grim-padding-grove cross-pod race,
      // e.g. surfaced during a rolling redeploy that boots a new API pod mid-job).
      // Genuinely dead workers stop extending → the lock decays and the BullMQ
      // stalled handler recovers them instead.
      if (await jobQueue.isJobLockFresh(job.jobId)) {
        logger.info(`Job ${job.jobId} lock is fresh — worker alive on another pod, skipping recovery`, { component: COMPONENT });
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

      // Only decomposable jobs (code/design/learn) checkpoint mid-graph, so
      // only they can resume "from where it stopped". plan/visual would just
      // restart — offering Resume there is misleading. The single owner
      // (buildInfrastructureInterruption) applies that jobType gate + the
      // canonical message; do NOT hand-build the details here (drift).
      const interruption: InterruptionDetails = buildInfrastructureInterruption('server_crash', jobType);

      if (!job.projectId || !job.featureName) {
        logger.warn(
          `Skipping Phase 1 recovery: missing projectId/featureName for ${job.jobId}`,
          { component: COMPONENT },
        );
        continue;
      }

      // POISON FLAG — acquire BEFORE pauseJob so a worker child still alive on
      // a not-yet-drained pod (rolling redeploy) has its un-gated `onCheckpoint`
      // (code/graph.ts, design/checkpoint.ts) short-circuited and cannot re-write
      // `state.runningTasks` UNMARKED after cleanup projects the interrupted
      // state. Mirrors the `/stop` route (job.routes.ts) and the stalled handlers
      // (JobWorker.ts / BullMQJobQueue.ts). `pauseJob` releases it after cleanup
      // (pauseJob.ts); idempotent via acquireLock NX, failure tolerated (600s TTL
      // auto-expires). Closes the grim-padding-grove KNOWN GAP.
      await stateStore.acquireLock(`ant:job-poisoned:${job.jobId}`, 600).catch(() => false);

      // SSOT — pauseJob handles cleanupJobState + updateJobStatus('paused')
      // while preserving Redis state so `/resume` can restart the job.
      await pauseJob(
        { cleanupJobState: deps.cleanupJobState },
        {
          jobId: job.jobId,
          projectId: job.projectId,
          featureName: job.featureName,
          jobType,
          userContext: job.userContext,
          interruption,
        },
      );

      // Best-effort BullMQ cleanup: with lockDuration=30s the lock has
      // likely already expired by startup time.
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
}

/**
 * Phase 1b — Paused jobs whose cancel/resume chat card was never successfully
 * emitted. `status='paused'` is set only by `pauseJob`, i.e. an interruption
 * with leftover work already decided the job is resumable-paused; we only
 * repair the missing card, we do not re-decide resumability. "Uncarded" is the
 * absence of the `ant:chat:cancelled-emitted:job:{id}` NX flag — set on a
 * successful emit, released by the resume paths — so a properly-carded (or
 * carded-then-resumed-and-recarded) job is skipped. Re-driving `pauseJob` is
 * idempotent: the pause lock + the card NX guard collapse duplicate work, and
 * `cleanupJobState` re-persists `state.interruption`. The jobType→canResume
 * gate (same `buildInfrastructureInterruption` owner Phase 1 uses) skips
 * plan/visual, which never offer a resume card.
 */
async function recoverUncardedPausedJobs(
  stateStore: ReturnType<ReturnType<typeof getInfrastructureFactory>['getStateStore']>,
  deps: StaleJobRecoveryDeps,
): Promise<void> {
  const pausedJobs = await stateStore.findJobsByStatus('paused');
  if (pausedJobs.length === 0) return;

  for (const job of pausedJobs) {
    try {
      if (!job.projectId || !job.featureName) continue;

      const mapping = await stateStore.getJobMapping(job.jobId);
      const jobType = (mapping?.jobType || job.type || 'code') as 'design' | 'code' | 'learn' | 'plan' | 'visual';

      // Single-owner jobType gate: plan/visual restart rather than resume, so
      // they never carry a resume card — nothing to repair. This server_crash
      // interruption is a FALLBACK only — `preferSessionInterruption` below
      // makes the session's recorded reason (e.g. tasks_failed) win, so the
      // repair card cannot mislabel a real failure as a server crash
      // (prime-nesting-grate RCA).
      const interruption: InterruptionDetails = buildInfrastructureInterruption('server_crash', jobType);
      if (!interruption.canResume) continue;

      // Uncarded ⇔ no successful cancelled-card emit recorded for this job.
      const carded = await stateStore.exists(`ant:chat:cancelled-emitted:job:${job.jobId}`);
      if (carded) continue;

      // Per-job idempotency shared with the stalled handlers / Phase 1.
      const jobLock = await stateStore.acquireLock(`${PER_JOB_LOCK_PREFIX}${job.jobId}`, PER_JOB_LOCK_TTL);
      if (!jobLock) continue;

      logger.info(
        `Uncarded paused job ${job.jobId} — re-driving pause to emit the missing resume card`,
        { component: COMPONENT, jobId: job.jobId, projectId: job.projectId, featureName: job.featureName },
      );

      await pauseJob(
        { cleanupJobState: deps.cleanupJobState },
        {
          jobId: job.jobId,
          projectId: job.projectId,
          featureName: job.featureName,
          jobType,
          userContext: job.userContext,
          interruption,
          preferSessionInterruption: true,
        },
      );
    } catch (err) {
      logger.warn(`Failed to re-card paused job ${job.jobId}`, { component: COMPONENT }, err);
    }
  }
}

/**
 * Phase 2 — Scan BullMQ completed/failed jobs and finalize any whose Redis
 * status still says 'running' or 'queued' (meaning the Pub/Sub completion
 * event was lost because the API Server was down). Drives every such job
 * through `finalizeTerminalJob` — same SSOT entry point used by live
 * completion handlers.
 *
 * Note: the original "Phase 3" label for this block is gone; it is Phase 2
 * under the new numbering (see module header).
 */
async function recoverMissedCompletions(
  jobQueue: BullMQJobQueue,
  stateStore: ReturnType<ReturnType<typeof getInfrastructureFactory>['getStateStore']>,
  deps: StaleJobRecoveryDeps,
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
        const finalStatus: 'completed' | 'failed' = isFailed ? 'failed' : 'completed';

        // Attach an interruption hint for failed jobs so the UX surfaces a
        // "canResume" affordance — `finalizeTerminalJob` forwards this to
        // the cancelled chat card. For completed jobs there's no interruption.
        // jobType-gated via the single owner (plan/visual → canResume:false).
        const interruption: InterruptionDetails | undefined = isFailed
          ? buildInfrastructureInterruption('server_crash', jobType)
          : undefined;

        const userContext = mapping?.userContext || payload?.userContext;

        // SSOT — finalizeTerminalJob handles append-to-runs + broadcast +
        // updateStatus(terminal) + seal + stateTracker cleanup, all behind
        // its own idempotency lock. Critically: failed Phase 2 jobs now
        // seal (fixing the pre-refactor invariant violation where
        // `updateJobStatus('failed')` kept Redis state for 24h).
        await finalizeTerminalJob(deps, {
          jobId: bullJob.id,
          finalStatus,
          projectId,
          featureName,
          jobType,
          userContext,
          interruption,
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

/**
 * Phase 3 — Sweep orphan terminal records in the jobsByFeature index.
 *
 * Happens when a previous `updateJobStatus(terminal)` call succeeded but
 * the subsequent seal didn't run (e.g. pre-refactor code, or a server
 * crash during the seal pipeline). Symptoms:
 *   - `listJobsByFeature` returns a completed/failed row that the UI's
 *     live-only filter defends against but that violates the invariant.
 *   - Or: status key expired (24h TTL) but SET membership lingered (SET
 *     TTL was refreshed every setJobStatus).
 *
 * This phase resolves both without touching the filesystem.
 */
async function recoverOrphanTerminalIndexEntries(
  stateStore: ReturnType<ReturnType<typeof getInfrastructureFactory>['getStateStore']>,
  deps: StaleJobRecoveryDeps,
): Promise<void> {
  let indexEntries: Awaited<ReturnType<typeof stateStore.scanJobsByFeatureIndex>>;
  try {
    indexEntries = await stateStore.scanJobsByFeatureIndex();
  } catch (err) {
    logger.warn(`Phase 3 scanJobsByFeatureIndex failed`, { component: COMPONENT }, err);
    return;
  }

  if (indexEntries.length === 0) return;

  let sealedCount = 0;
  let sremCount = 0;

  for (const entry of indexEntries) {
    const { projectId, featureName, jobIds } = entry;
    for (const jobId of jobIds) {
      try {
        const status = await stateStore.getJobStatus(jobId);

        // Status key evicted but SET still has the jobId — srem and move on.
        if (!status) {
          try {
            await stateStore.removeJobFromFeatureIndex(projectId, featureName, jobId);
            sremCount++;
          } catch (err) {
            logger.warn(
              `Phase 3: removeJobFromFeatureIndex failed for ${jobId}`,
              { component: COMPONENT },
              err,
            );
          }
          continue;
        }

        // Terminal status still lingering → seal missed. Finalize idempotently.
        if (status.status === 'completed' || status.status === 'failed') {
          const mapping = await stateStore.getJobMapping(jobId);
          const jobType = (mapping?.jobType || status.type || 'code') as 'design' | 'code' | 'learn' | 'plan' | 'visual';
          const userContext = mapping?.userContext || status.userContext;
          await finalizeTerminalJob(deps, {
            jobId,
            finalStatus: status.status,
            projectId,
            featureName,
            jobType,
            userContext,
          });
          sealedCount++;
        }
        // running / paused → Phase 1 territory.
      } catch (err) {
        logger.warn(`Phase 3: sweep failed for ${jobId}`, { component: COMPONENT }, err);
      }
    }
  }

  if (sealedCount > 0 || sremCount > 0) {
    logger.info(
      `Phase 3 complete: sealed=${sealedCount}, orphan-index-srem=${sremCount}`,
      { component: COMPONENT },
    );
  }
}
