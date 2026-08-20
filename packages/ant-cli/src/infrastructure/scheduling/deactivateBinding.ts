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
import { REDIS_KEYS } from '../../core/constants/redis';
import type { PipelineOwner, ScheduleQueuePort } from '../../core/ports/scheduler';
import type { StateStorePort } from '../../core/ports/stateStore';
import { deriveActivationsRoot } from '../../core/pipelines/paths';
import { deleteActivationRecord, loadActivationByProject } from '../../core/pipelines/store';
import { getRealtimeBroadcastChannel } from '../state/redisConstants';
import { schedulerIdFor } from './PipelineReconciler';
import type { PipelineRunCoordinator } from './PipelineRunCoordinator';

export interface DeactivateBindingDeps {
  workspacesPath: string;
  scheduleQueue: Pick<ScheduleQueuePort, 'removeCron'>;
  coordinator: Pick<PipelineRunCoordinator, 'deactivate'>;
  stateStore: Pick<StateStorePort, 'deleteKey' | 'publish'>;
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
  let activation: PipelineActivation | null = null;
  let unreadable = false;
  try {
    activation = loadActivationByProject(actRoot, projectId);
  } catch {
    unreadable = true; // unreadable sidecar: the legs below clear it anyway
  }
  const hadActivation = activation !== null || unreadable;

  await deps.scheduleQueue.removeCron(schedulerIdFor(owner, projectId));
  await deps.coordinator.deactivate(owner, projectId);
  deleteActivationRecord(actRoot, projectId);
  await deps.stateStore
    .deleteKey(REDIS_KEYS.PIPE.ACTIVATION(owner.organizationId, owner.userId, projectId))
    .catch(() => {});
  await deps.stateStore
    .deleteKey(REDIS_KEYS.PIPE.PROJECT(owner.organizationId, owner.userId, projectId))
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
