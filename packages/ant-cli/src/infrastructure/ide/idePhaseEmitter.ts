/**
 * IDE phase event emitter — publishes `idePhase` SSE events to the user-scoped
 * Redis broadcast channel so the FE can render a fine-grained startup overlay.
 *
 * Behavior is delegated to the shared {@link createPhaseEmitter} factory:
 *   1. Dedup: same phase consecutively emitted is a no-op.
 *   2. Throttle: `image-pulling` re-emits at most once per 5s so the elapsed
 *      counter on the FE counter ticks during the long cold-pull window.
 *
 * `IdePhase` lacks an explicit success/failure status (each phase advancing
 * IS the success signal). We pass a fixed `'active'` placeholder so the
 * factory's `(phase, status)` dedup key collapses to `phase` alone — matching
 * the original single-key dedup behavior.
 */

import { StateStorePort } from '../../core/ports/stateStore';
import { UserContext } from '../../core/types/user';
import { createPhaseEmitter } from '../../core/realtime/createPhaseEmitter';
import type { IdePhase, IdePhaseEventData } from '@ant/shared';

export interface IdePhaseEmitter {
  emit(phase: IdePhase, detail?: string): Promise<void>;
}

const IMAGE_PULLING_THROTTLE_MS = 5_000;

export function createIdePhaseEmitter(
  stateStore: StateStorePort,
  userContext: UserContext,
  projectId: string,
  featureName: string,
  startedAt: number,
  now: () => number = Date.now,
): IdePhaseEmitter {
  const sessionKey = `${projectId}:${featureName}`;
  const inner = createPhaseEmitter<IdePhase, 'active', 'idePhase'>(
    stateStore,
    { userContext, sessionKey, startedAt },
    {
      messageType: 'idePhase',
      buildData: ({ phase, sessionKey: sk, elapsedMs, detail }): IdePhaseEventData => ({
        phase,
        projectId,
        featureName,
        sessionKey: sk,
        elapsedMs,
        ...(detail !== undefined ? { detail } : {}),
      }),
      throttle: (phase) => (phase === 'image-pulling' ? IMAGE_PULLING_THROTTLE_MS : null),
      now,
      component: 'IdePhaseEmitter',
    },
  );

  return {
    emit: (phase, detail) => inner.emit(phase, 'active', detail),
  };
}
