/**
 * IDE phase event emitter — publishes `idePhase` SSE events to the user-scoped
 * Redis broadcast channel so the FE can render a fine-grained startup overlay.
 *
 * Two behaviors:
 *
 *   1. **Dedup**: same phase consecutively emitted is a no-op (`pod-pending` →
 *      `pod-pending` skipped). Different phases always publish.
 *   2. **Image-pulling throttle**: while the pod sits in `image-pulling` (the
 *      long cold-pull window), we still want the FE counter to tick — but not
 *      every 2s poll. Allow at most one re-emit per 5s so the elapsedMs in the
 *      payload advances.
 *
 * The emitter knows the session's `startedAt` so each event carries
 * `elapsedMs = now - startedAt` — the FE shows that as "X초 경과" without
 * having to compute the offset itself.
 *
 * Failures are swallowed with a warn — a missed phase event is cosmetic and
 * must never block pod startup.
 */

import { StateStorePort } from '../../core/ports/stateStore';
import { UserContext } from '../../core/types/user';
import { getRealtimeBroadcastChannel } from '../../core/constants/redis';
import { logger } from '../../utils/logger';
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
  let lastPhase: IdePhase | null = null;
  let lastImagePullingAt = 0;

  return {
    async emit(phase, detail) {
      const t = now();

      if (lastPhase === phase) {
        if (phase !== 'image-pulling') return;
        if (t - lastImagePullingAt < IMAGE_PULLING_THROTTLE_MS) return;
      }

      lastPhase = phase;
      if (phase === 'image-pulling') lastImagePullingAt = t;

      const channel = getRealtimeBroadcastChannel(
        userContext.organizationId,
        userContext.userId,
      );
      const data: IdePhaseEventData = {
        phase,
        projectId,
        featureName,
        sessionKey,
        elapsedMs: t - startedAt,
        ...(detail !== undefined ? { detail } : {}),
      };

      try {
        await stateStore.publish(channel, { type: 'idePhase', data });
      } catch (err: any) {
        logger.warn(`idePhase publish failed (cosmetic — ignored): ${err?.message ?? err}`, {
          component: 'IdePhaseEmitter',
        });
      }
    },
  };
}
