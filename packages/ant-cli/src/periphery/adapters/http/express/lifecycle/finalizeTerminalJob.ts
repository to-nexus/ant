/**
 * finalizeTerminalJob — the canonical SSOT entry point for transitioning a
 * job to a **terminal** state (`completed` / `failed`). Companion to
 * `pauseJob` (paused transitions that preserve Redis).
 *
 * Invariant (post-finalize):
 *   - Session file `runs[]` has the terminal run appended with its final
 *     kanbanSnapshot (via `cleanupJobState` → `broadcastFinalUpdate` →
 *     `appendJobSnapshotToSession`).
 *   - Redis has **zero** keys tied to this jobId — status, logs, taskQueue
 *     (+ checkpoint), workflow, mapping, userStopped, killReason, and the
 *     jobsByFeature SET entry are all DEL'd.
 *   - BullMQ retains the job record for 24h (completed) / 7d (failed) per
 *     queue-level retention — untouched by this flow.
 *
 * Idempotency:
 *   Acquires a single `ant:job-finalize:{id}` lock (120s TTL) before
 *   proceeding. Additionally acquires the legacy
 *   `ant:job-event:{id}:completed` + `:failed` locks so the
 *   RouteConfigurator JOB_STATUS_UPDATES handler — which also claims
 *   these legacy keys upstream of BullMQ — cannot race with a finalize
 *   already in progress. All three are released by the Resume paths
 *   ([job.routes.ts] /resume, /continue, /decompose-choice proceed) so a
 *   resumed jobId can finalize again in the future.
 *
 * Order:
 *   1. Acquire `ant:job-finalize:{id}` lock. On miss, log + return
 *      (another call-site is already finalizing).
 *   2. Claim the legacy event locks too (best-effort; safe no-ops when
 *      already held by the subscriber side).
 *   3. `cleanupJobState` — session-patch + broadcast + snapshot append +
 *      cancelled chat message (when interruption present).
 *   4. `updateJobStatus(finalStatus)` — null-safe; no-op if already sealed.
 *   5. `sealJobRedisState` — DEL all Redis keys + SREM jobsByFeature SET.
 *      (Disk debug artifacts are preserved for post-mortem.)
 *   6. `stateTracker.cleanup` — drop in-memory snapshot (already done by
 *      `broadcastFinalUpdate` when the job has a kanban, but this is a
 *      belt-and-suspenders call for the no-kanban path).
 *
 * Use from any terminal transition:
 *   - `RouteConfigurator JOB_STATUS_UPDATES` completed (no interruption)
 *   - `RouteConfigurator JOB_STATUS_UPDATES` failed
 *   - `/jobs/:id/stop`
 *   - `/job/dismiss` (paused → failed)
 *   - `/execute` zombie-paused auto-dismiss
 *   - `/chat/decompose-choice` redirect_to_design / cancel
 *   - `DELETE /features/:feature` cascade (per-job iteration)
 *   - Hard Reset (`/context/reset`) per-job iteration
 *   - `StaleJobRecovery` Phase 2 (missed BullMQ completions)
 *   - `StaleJobRecovery` Phase 3 (orphan terminal sweep)
 */

import type { InterruptionDetails } from '../../../../../core/types';
import type { UserContext } from '../../../../../core/types/user';
import type { SessionableJobType } from '@ant/shared';
import type { KanbanService } from '../../services';
import { getInfrastructureFactory } from '../../../../../infrastructure/adapters/InfrastructureFactory';
import { logger } from '../../../../../utils/logger';
import type { JobCleanupManager } from '../managers/JobCleanupManager';
import { sealJobRedisState } from '../../routes/helpers/sessionCleanup';
import type { JobStateTracker } from '../managers/JobStateTracker';

const COMPONENT = 'FinalizeTerminalJob';
const LOCK_TTL_SECONDS = 120;

export interface FinalizeTerminalJobArgs {
  jobId: string;
  finalStatus: 'completed' | 'failed';
  projectId: string;
  featureName: string;
  jobType: SessionableJobType;
  userContext?: UserContext;
  /** Present for user-initiated stop / dismiss / cancel / crash recovery. */
  interruption?: InterruptionDetails;
  /** Resolved feature path (kept for call-site compatibility). */
  featurePath?: string;
  /**
   * Skip `cleanupJobState` (session-patch + broadcast). Used by Feature
   * DELETE cascade where the entire feature directory is about to be
   * rm -rf'd (no point writing back to session.json).
   */
  skipSessionPatch?: boolean;
}

export interface FinalizeTerminalJobDeps {
  cleanupJobState: JobCleanupManager['cleanupJobState'];
  stateTracker: JobStateTracker;
  kanbanService?: KanbanService;
}

export async function finalizeTerminalJob(
  deps: FinalizeTerminalJobDeps,
  args: FinalizeTerminalJobArgs,
): Promise<void> {
  const {
    jobId,
    finalStatus,
    projectId,
    featureName,
    jobType,
    userContext,
    interruption,
    skipSessionPatch = false,
  } = args;

  const stateStore = getInfrastructureFactory().getStateStore();

  // 1. Primary idempotency — single atomic lock so concurrent finalize
  //    attempts for the same jobId can never both proceed. Failing to
  //    acquire this means another call-site is already running through
  //    the pipeline below, so we bail out without touching any state.
  const finalizeLock = `ant:job-finalize:${jobId}`;
  const finalizeAcquired = await stateStore.acquireLock(finalizeLock, LOCK_TTL_SECONDS);
  if (!finalizeAcquired) {
    logger.debug(
      `finalizeTerminalJob skipped — another finalize in progress (jobId=${jobId})`,
      { component: COMPONENT, jobId },
    );
    return;
  }

  // 2. Legacy event locks — also claim these so the RouteConfigurator
  //    subscriber cannot race via the secondary key path. Best-effort;
  //    a failure here just means the subscriber already has them, which
  //    is fine because we own the primary finalize lock anyway.
  const completedLock = `ant:job-event:${jobId}:completed`;
  const failedLock = `ant:job-event:${jobId}:failed`;
  await stateStore.acquireLock(completedLock, LOCK_TTL_SECONDS).catch(() => false);
  await stateStore.acquireLock(failedLock, LOCK_TTL_SECONDS).catch(() => false);

  logger.info(
    `finalizeTerminalJob: ${jobId} → ${finalStatus}` +
      (interruption ? ` (interruption=${interruption.reason})` : ''),
    { component: COMPONENT, jobId, projectId, featureName },
  );

  // 2. Session patch + broadcast + cancelled chat message. Skipped for
  //    Feature DELETE cascade where the directory is about to be removed.
  //    finalStatus is forwarded so cleanupJobState/broadcastFinalUpdate
  //    can write the correct SessionRun.status + kanbanSnapshot.status —
  //    in particular for the failed-without-interruption case (orchestrator
  //    deadlock, child crash) where the legacy interruption-only derivation
  //    silently fell back to 'completed' (such-pinning-milky RCA).
  if (!skipSessionPatch) {
    try {
      await deps.cleanupJobState(
        jobId,
        projectId,
        featureName,
        interruption,
        jobType,
        userContext,
        finalStatus,
      );
    } catch (err) {
      // Non-fatal: the seal below still runs to protect the invariant.
      logger.warn(
        `cleanupJobState failed during finalize — proceeding to seal`,
        { component: COMPONENT, jobId },
        err,
      );
    }
  }

  // 3. Terminal status write (null-safe — no-op if already sealed elsewhere).
  try {
    await stateStore.updateJobStatus(jobId, {
      status: finalStatus,
      completedAt: new Date().toISOString(),
      error: interruption?.message,
    });
  } catch (err) {
    logger.warn(
      `updateJobStatus(${finalStatus}) failed during finalize`,
      { component: COMPONENT, jobId },
      err,
    );
  }

  // 3b. Billing settle — MUST run BEFORE sealJobRedisState (which DELs the
  //     taskQueue snapshot that carries the per-model usage). Reads the final
  //     per-model token usage, computes precise USD at list price, and finalizes
  //     the debit. The live meter has already charged most of this incrementally
  //     (monotonic `charged:{jobId}`); settle moves the balance to the final
  //     cumulative target (capturing the last delta) and writes the single
  //     coalesced `debit` ledger row, then releases the hold. Idempotent per
  //     jobId; non-fatal (never blocks teardown). Recording is always on.
  try {
    if (userContext?.organizationId && userContext?.userId) {
      const ledger = getInfrastructureFactory().getCreditLedger();
      const snapshot = await stateStore.getTaskQueue(jobId);
      const byModel = snapshot?.tokenUsageByModel;
      if (byModel && Object.keys(byModel).length > 0) {
        const { computeJobCostUsd, computeModelCostBreakdownUsd } = await import('@ant/shared');
        const { usd, unknownModelIds } = computeJobCostUsd(byModel as Record<string, any>);
        await ledger.settle({
          jobId,
          orgId: userContext.organizationId,
          userId: userContext.userId,
          usdCost: usd,
          modelBreakdown: computeModelCostBreakdownUsd(byModel as Record<string, any>),
          projectId,
          featureName,
          ...(unknownModelIds.length > 0 && {
            note: `unknown model fallback: ${unknownModelIds.join(', ')}`,
          }),
        });
      } else {
        // No usage to debit (e.g. reflex/no-LLM job) — still release any hold.
        await ledger.releaseHold(jobId);
      }
    }
  } catch (err) {
    logger.warn(
      `billing settle failed during finalize — proceeding to seal`,
      { component: COMPONENT, jobId },
      err,
    );
  }

  // 4. Seal Redis only. Disk debug artifacts are preserved here and are
  //    scrubbed only in explicit destructive flows (job delete/reset/delete feature).
  await sealJobRedisState(
    stateStore,
    deps.kanbanService,
    jobId,
  );

  // 5. In-memory tracker cleanup (redundant if broadcastFinalUpdate already
  //    did it for decomposable jobs — cleanup() is idempotent).
  deps.stateTracker.cleanup(jobId);

  logger.info(`Sealed jobId=${jobId}`, { component: COMPONENT, jobId });
}
