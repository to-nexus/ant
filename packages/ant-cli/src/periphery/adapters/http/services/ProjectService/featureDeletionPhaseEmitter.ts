/**
 * Feature deletion phase emitter — publishes `featureDeletionPhase` SSE
 * events as the cascade walks through its 5 steps so the FE can render
 * the feature deletion step rail in real time.
 *
 * Delegates to {@link createPhaseEmitter} — see that file for dedup
 * semantics. No throttle is needed (deletion phases are short-lived and
 * fire once each).
 *
 * `sessionKey = `${projectId}:${featureName}`` — disambiguates concurrent
 * deletions across features within the same project. The FE drops stale
 * events whose sessionKey doesn't match the current `featureDeletionSession`.
 */

import type {
  FeatureDeletionPhase,
  FeatureDeletionPhaseEventData,
  PhaseStatus,
} from '@ant/shared';
import type { StateStorePort } from '../../../../../core/ports/stateStore';
import type { UserContext } from '../../../../../core/types/user';
import {
  createPhaseEmitter,
  type PhaseEmitter,
} from '../../../../../core/realtime/createPhaseEmitter';

export type FeatureDeletionPhaseEmitter = PhaseEmitter<
  FeatureDeletionPhase,
  PhaseStatus
>;

export function createFeatureDeletionPhaseEmitter(
  stateStore: StateStorePort,
  userContext: UserContext,
  projectId: string,
  featureName: string,
  startedAt: number,
  now: () => number = Date.now,
): FeatureDeletionPhaseEmitter {
  const sessionKey = `${projectId}:${featureName}`;
  return createPhaseEmitter<
    FeatureDeletionPhase,
    PhaseStatus,
    'featureDeletionPhase'
  >(
    stateStore,
    { userContext, sessionKey, startedAt },
    {
      messageType: 'featureDeletionPhase',
      buildData: ({ phase, status, sessionKey, elapsedMs, detail }): FeatureDeletionPhaseEventData => ({
        phase,
        status,
        projectId,
        featureName,
        sessionKey,
        elapsedMs,
        ...(detail !== undefined ? { detail } : {}),
      }),
      now,
      component: 'FeatureDeletionPhaseEmitter',
    },
  );
}
