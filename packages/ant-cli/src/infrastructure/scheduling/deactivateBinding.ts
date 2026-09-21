/**
 * The ONE deactivation authority for a pipeline↔project binding — shared by
 * the HTTP deactivate route and the project delete/rename cascade so the
 * legs can never drift: tombstone → live runs cancelled + running steps
 * killed → activation.json unlinked (runs survive) → projections cleared →
 * SSE `activationChanged` (null activation) → schedulers removed.
 *
 * Idempotent: a project with no activation is a no-op success (every leg
 * tolerates absence), so the cascade may call it unconditionally — which
 * also heals orphaned crons/projections left by a crashed deactivate.
 *
 * Durable legs first, scheduler removal LAST and bounded: the BullMQ queue
 * connection has no command timeout, and a stalled `removeJobScheduler` used
 * to sit in front of the unlink — the record stayed, the UI stayed locked, and
 * nothing was logged. Scheduler removal is not a correctness condition here:
 * the reconciler's orphan sweep removes any scheduler whose record is gone,
 * and a fire that lands in the window re-reads the authority (tombstone) and
 * skips. Every leg's elapsed time is logged in one line — the deactivate path
 * previously left no trace on either outcome.
 */

import type { PipelineActivation } from '@ant/shared';
import { REDIS_KEYS, REDIS_TTL } from '../../core/constants/redis';
import type { PipelineOwner, ScheduleQueuePort } from '../../core/ports/scheduler';
import type { StateStorePort } from '../../core/ports/stateStore';
import { approverUnion, syncApproverIndexForActivation } from '../../core/pipelines/approverIndex';
import { deriveActivationsRoot } from '../../core/pipelines/paths';
import { deleteActivationRecord } from '../../core/pipelines/store';
import { logger } from '../../utils/logger';
import { getRealtimeBroadcastChannel } from '../state/redisConstants';
import { fetchSchedulerIdFor, schedulerIdFor } from './PipelineReconciler';
import type { PipelineRunCoordinator } from './PipelineRunCoordinator';
import { resolveActivation, unindexActivationProjection, type DeactivationTombstone } from './resolveActivation';

const COMPONENT = 'PipelineDeactivate';
/** Scheduler removal is best-effort — the orphan sweep is the guarantee. */
export const SCHEDULER_LEG_TIMEOUT_MS = 5_000;

export interface DeactivateBindingDeps {
  workspacesPath: string;
  scheduleQueue: Pick<ScheduleQueuePort, 'removeCron'>;
  coordinator: Pick<PipelineRunCoordinator, 'deactivate'>;
  stateStore: Pick<StateStorePort, 'deleteKey' | 'publish' | 'getKey' | 'setKeyWithTTL' | 'releaseSlot'>;
  /** Test seam for the scheduler-leg bound. */
  schedulerLegTimeoutMs?: number;
}

type LegOutcome = 'ok' | 'timeout' | 'error';

/** Await `leg` for at most `ms`; the promise keeps running past the bound, only the wait ends. */
async function settleWithin(leg: Promise<unknown>, ms: number): Promise<LegOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<LegOutcome>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms);
  });
  try {
    return await Promise.race([leg.then((): LegOutcome => 'ok', (): LegOutcome => 'error'), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function deactivatePipelineBinding(
  deps: DeactivateBindingDeps,
  owner: PipelineOwner,
  projectId: string,
  opts: {
    /** SSE pipelineId when the activation sidecar is unreadable (route path). */
    pipelineIdHint?: string;
  } = {},
): Promise<{ hadActivation: boolean; pipelineId: string | null }> {
  const marks: string[] = [];
  const timed = async <T>(name: string, fn: () => Promise<T> | T): Promise<T> => {
    const started = Date.now();
    try {
      return await fn();
    } finally {
      marks.push(`${name} ${Date.now() - started}ms`);
    }
  };

  const actRoot = deriveActivationsRoot({ workspacesPath: deps.workspacesPath, ...owner });
  // Disk, then the projection: the record may exist on the server while this
  // pod's NFS view still answers ENOENT (an unreadable sidecar counts as held).
  const resolved = await timed('resolve', () => resolveActivation(deps.stateStore, deps.workspacesPath, owner, projectId));
  const activation: PipelineActivation | null = resolved.activation;
  const hadActivation = activation !== null || resolved.unreadable;
  const pipelineId = activation?.pipelineId ?? opts.pipelineIdHint ?? null;

  // Tombstone FIRST: the unlink below is not verifiable from here, so the
  // reconciler finishes it from a pod that sees the file, and every reader
  // treats a record no newer than this as gone. Activate clears it.
  const tombstone: DeactivationTombstone = { pipelineId, at: new Date().toISOString() };
  await timed('tombstone', () =>
    deps.stateStore
      .setKeyWithTTL(
        REDIS_KEYS.PIPE.DEACTIVATED(owner.organizationId, owner.userId, projectId),
        JSON.stringify(tombstone),
        REDIS_TTL.PIPE.DEACTIVATED,
      )
      .catch(() => {}),
  );

  const cancelled = await timed('cancel', () => deps.coordinator.deactivate(owner, projectId));
  marks[marks.length - 1] += ` (runs ${cancelled})`;
  await timed('unlink', () => deleteActivationRecord(actRoot, projectId));
  // Approver-of discovery entries for this activation go with it (advisory —
  // resolve authority already re-reads the deleted sidecar and refuses).
  await timed('approvers', () =>
    syncApproverIndexForActivation(deps.stateStore, owner.organizationId, owner.userId, projectId, approverUnion(activation), []),
  );
  await timed('projections', async () => {
    await deps.stateStore.deleteKey(REDIS_KEYS.PIPE.ACTIVATION(owner.organizationId, owner.userId, projectId)).catch(() => {});
    await unindexActivationProjection(deps.stateStore, owner, projectId);
    await deps.stateStore.deleteKey(REDIS_KEYS.PIPE.PROJECT(owner.organizationId, owner.userId, projectId)).catch(() => {});
    // Poll telemetry and the claim-projection marker go with the binding; the
    // claims themselves stay (per-pipeline disk ledger = history, Redis keys
    // lapse on TTL) — re-activating the SAME pipeline must not re-fire cases
    // that already ran, and another pipeline's keys live in its own namespace.
    await deps.stateStore.deleteKey(REDIS_KEYS.PIPE.FETCH_STATUS(owner.organizationId, owner.userId, projectId)).catch(() => {});
    await deps.stateStore.deleteKey(REDIS_KEYS.PIPE.ITEMS_BUILT(owner.organizationId, owner.userId, projectId)).catch(() => {});
  });

  if (hadActivation && pipelineId) {
    await timed('publish', async () => {
      try {
        await deps.stateStore.publish(getRealtimeBroadcastChannel(owner.organizationId, owner.userId), {
          type: 'pipeline',
          data: {
            cause: 'activationChanged',
            pipelineId,
            projectId,
            activation: null,
            activatedBy: owner.userId,
          },
          userContext: { userId: owner.userId, organizationId: owner.organizationId },
        });
      } catch {
        /* SSE refresh hint only — never block the write */
      }
    });
  }

  // Schedulers last, bounded, in parallel — see the header.
  const bound = deps.schedulerLegTimeoutMs ?? SCHEDULER_LEG_TIMEOUT_MS;
  await timed('cron', async () => {
    const ids = [schedulerIdFor(owner, projectId), fetchSchedulerIdFor(owner, projectId)];
    const outcomes = await Promise.all(ids.map((id) => settleWithin(deps.scheduleQueue.removeCron(id), bound)));
    outcomes.forEach((outcome, i) => {
      if (outcome === 'ok') return;
      logger.warn(
        `[Pipeline] deactivate ${projectId}: removeCron(${ids[i]}) ${outcome === 'timeout' ? `did not settle within ${bound}ms` : 'failed'} — the reconciler sweep removes it`,
        { component: COMPONENT },
      );
    });
  });

  const record = resolved.source ?? (resolved.unreadable ? 'unreadable' : 'none');
  logger.info(`[Pipeline] deactivated ${projectId} (pipeline ${pipelineId ?? '?'}, record=${record}): ${marks.join(' · ')}`, {
    component: COMPONENT,
  });
  return { hadActivation, pipelineId };
}
