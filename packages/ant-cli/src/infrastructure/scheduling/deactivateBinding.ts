/**
 * The ONE deactivation authority for a pipeline↔project binding — shared by
 * the HTTP deactivate route and the project delete/rename cascade so the
 * legs can never drift: cron off → live run cancelled + running steps
 * killed → activation.json unlinked (runs survive) → projections cleared →
 * SSE `activationChanged` (null activation).
 *
 * Idempotent: a project with no activation is a no-op success (every leg
 * tolerates absence), so the cascade may call it unconditionally — which
 * also heals orphaned crons/projections left by a crashed deactivate.
 */

import type { PipelineActivation } from '@ant/shared';
import { REDIS_KEYS, REDIS_TTL } from '../../core/constants/redis';
import type { PipelineOwner, ScheduleQueuePort } from '../../core/ports/scheduler';
import type { StateStorePort } from '../../core/ports/stateStore';
import { approverUnion, syncApproverIndexForActivation } from '../../core/pipelines/approverIndex';
import { deriveActivationsRoot } from '../../core/pipelines/paths';
import { deleteActivationRecord } from '../../core/pipelines/store';
import { getRealtimeBroadcastChannel } from '../state/redisConstants';
import { fetchSchedulerIdFor, schedulerIdFor } from './PipelineReconciler';
import type { PipelineRunCoordinator } from './PipelineRunCoordinator';
import { resolveActivation, unindexActivationProjection, type DeactivationTombstone } from './resolveActivation';

export interface DeactivateBindingDeps {
  workspacesPath: string;
  scheduleQueue: Pick<ScheduleQueuePort, 'removeCron'>;
  coordinator: Pick<PipelineRunCoordinator, 'deactivate'>;
  stateStore: Pick<StateStorePort, 'deleteKey' | 'publish' | 'getKey' | 'setKeyWithTTL' | 'releaseSlot'>;
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
  const actRoot = deriveActivationsRoot({ workspacesPath: deps.workspacesPath, ...owner });
  // Disk, then the projection: the record may exist on the server while this
  // pod's NFS view still answers ENOENT (an unreadable sidecar counts as held).
  const resolved = await resolveActivation(deps.stateStore, deps.workspacesPath, owner, projectId);
  const activation: PipelineActivation | null = resolved.activation;
  const hadActivation = activation !== null || resolved.unreadable;

  // Tombstone FIRST: the unlink below is not verifiable from here, so the
  // reconciler finishes it from a pod that sees the file, and every reader
  // treats a record no newer than this as gone. Activate clears it.
  const tombstone: DeactivationTombstone = {
    pipelineId: activation?.pipelineId ?? opts.pipelineIdHint ?? null,
    at: new Date().toISOString(),
  };
  await deps.stateStore
    .setKeyWithTTL(
      REDIS_KEYS.PIPE.DEACTIVATED(owner.organizationId, owner.userId, projectId),
      JSON.stringify(tombstone),
      REDIS_TTL.PIPE.DEACTIVATED,
    )
    .catch(() => {});

  await deps.scheduleQueue.removeCron(schedulerIdFor(owner, projectId));
  await deps.scheduleQueue.removeCron(fetchSchedulerIdFor(owner, projectId));
  await deps.coordinator.deactivate(owner, projectId);
  deleteActivationRecord(actRoot, projectId);
  // Approver-of discovery entries for this activation go with it (advisory —
  // resolve authority already re-reads the deleted sidecar and refuses).
  await syncApproverIndexForActivation(
    deps.stateStore,
    owner.organizationId,
    owner.userId,
    projectId,
    approverUnion(activation),
    [],
  );
  await deps.stateStore
    .deleteKey(REDIS_KEYS.PIPE.ACTIVATION(owner.organizationId, owner.userId, projectId))
    .catch(() => {});
  await unindexActivationProjection(deps.stateStore, owner, projectId);
  await deps.stateStore
    .deleteKey(REDIS_KEYS.PIPE.PROJECT(owner.organizationId, owner.userId, projectId))
    .catch(() => {});
  // Poll telemetry and the claim-projection marker go with the binding; the
  // claims themselves stay (per-pipeline disk ledger = history, Redis keys
  // lapse on TTL) — re-activating the SAME pipeline must not re-fire cases
  // that already ran, and another pipeline's keys live in its own namespace.
  await deps.stateStore
    .deleteKey(REDIS_KEYS.PIPE.FETCH_STATUS(owner.organizationId, owner.userId, projectId))
    .catch(() => {});
  await deps.stateStore
    .deleteKey(REDIS_KEYS.PIPE.ITEMS_BUILT(owner.organizationId, owner.userId, projectId))
    .catch(() => {});

  const pipelineId = activation?.pipelineId ?? opts.pipelineIdHint ?? null;
  if (hadActivation && pipelineId) {
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
  }
  return { hadActivation, pipelineId };
}
