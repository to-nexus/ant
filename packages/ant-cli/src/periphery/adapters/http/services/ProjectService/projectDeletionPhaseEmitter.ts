/**
 * Project deletion phase emitter — publishes `projectDeletionPhase` SSE
 * events as the cascade walks through its 5 steps so the FE can render
 * the deletion step rail in real time.
 *
 * Delegates to {@link createPhaseEmitter} — see that file for dedup
 * semantics. No throttle is needed (deletion phases are short-lived and
 * fire once each).
 *
 * `sessionKey = projectId` — only one deletion can be in-flight per
 * project at a time. The FE drops stale events whose sessionKey doesn't
 * match the current `projectDeletionSession`.
 */

import type {
  ProjectDeletionPhase,
  ProjectDeletionPhaseEventData,
  ProjectDeletionPhaseStatus,
} from '@ant/shared';
import type { StateStorePort } from '../../../../../core/ports/stateStore';
import type { UserContext } from '../../../../../core/types/user';
import {
  createPhaseEmitter,
  type PhaseEmitter,
} from '../../../../../core/realtime/createPhaseEmitter';

export type ProjectDeletionPhaseEmitter = PhaseEmitter<
  ProjectDeletionPhase,
  ProjectDeletionPhaseStatus
>;

export function createProjectDeletionPhaseEmitter(
  stateStore: StateStorePort,
  userContext: UserContext,
  projectId: string,
  startedAt: number,
  now: () => number = Date.now,
): ProjectDeletionPhaseEmitter {
  return createPhaseEmitter<
    ProjectDeletionPhase,
    ProjectDeletionPhaseStatus,
    'projectDeletionPhase'
  >(
    stateStore,
    { userContext, sessionKey: projectId, startedAt },
    {
      messageType: 'projectDeletionPhase',
      buildData: ({ phase, status, sessionKey, elapsedMs, detail }): ProjectDeletionPhaseEventData => ({
        phase,
        status,
        projectId,
        sessionKey,
        elapsedMs,
        ...(detail !== undefined ? { detail } : {}),
      }),
      now,
      component: 'ProjectDeletionPhaseEmitter',
    },
  );
}
