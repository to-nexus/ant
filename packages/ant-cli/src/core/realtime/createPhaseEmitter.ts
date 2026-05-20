/**
 * Phase emitter factory — shared SSOT for sub-phase progress SSE.
 *
 * Both `idePhaseEmitter` (IDE pod startup) and `projectDeletionPhaseEmitter`
 * (project deletion cascade) use this factory. They differ only in:
 *   - the `SSEMessageType` they publish under (`'idePhase'` vs `'projectDeletionPhase'`)
 *   - the `buildData` payload shape (`IdePhaseEventData` vs `ProjectDeletionPhaseEventData`)
 *   - the (optional) per-phase throttle (IDE's `image-pulling` ticks every 5s
 *     so the elapsed counter advances; deletion has none)
 *
 * Two behaviors are factored here:
 *
 *   1. **Dedup**: same `(phase, status)` consecutively emitted is a no-op
 *      unless the phase is throttle-eligible AND the throttle window has passed.
 *   2. **Throttle** (optional): a phase-keyed `(phase) => ms | null` callback
 *      lets specific phases re-emit periodically so elapsed counters tick.
 *
 * Publish failures are swallowed with a `warn` — a missed phase event is
 * cosmetic and must never block the underlying lifecycle action.
 */

import type { SSEMessageMap } from '@ant/shared';
import type { StateStorePort } from '../ports/stateStore';
import type { UserContext } from '../types/user';
import { getRealtimeBroadcastChannel } from '../constants/redis';
import { logger } from '../../utils/logger';

export interface PhaseEmitterContext {
  userContext: UserContext;
  sessionKey: string;
  startedAt: number;
}

/**
 * Constrains `TMessageType` to keys actually present in `SSEMessageMap`
 * (currently `'idePhase' | 'projectDeletionPhase' | 'gitState'`). The
 * broader `SSEMessageType` union also includes events without a typed
 * payload entry — those wouldn't satisfy `SSEMessageMap[TMessageType]`.
 */
export interface PhaseEmitterOptions<
  TPhase extends string,
  TStatus extends string,
  TMessageType extends keyof SSEMessageMap,
> {
  messageType: TMessageType;
  buildData: (args: {
    phase: TPhase;
    status: TStatus;
    sessionKey: string;
    elapsedMs: number;
    detail?: string;
  }) => SSEMessageMap[TMessageType];
  /** Phase-keyed throttle window in ms. Return null/undefined for no throttle. */
  throttle?: (phase: TPhase) => number | null | undefined;
  /** Optional clock override for tests. */
  now?: () => number;
  /** Component tag for warn logs. */
  component?: string;
}

export interface PhaseEmitter<TPhase extends string, TStatus extends string> {
  emit(phase: TPhase, status: TStatus, detail?: string): Promise<void>;
}

interface DedupState<TPhase extends string, TStatus extends string> {
  lastPhase: TPhase | null;
  lastStatus: TStatus | null;
  lastThrottledAt: number;
}

/**
 * Build a phase emitter bound to a single session (sessionKey + startedAt).
 *
 * Callers create one emitter per session lifetime and discard it when the
 * session ends; dedup state lives in the closure, no module-level state.
 */
export function createPhaseEmitter<
  TPhase extends string,
  TStatus extends string,
  TMessageType extends keyof SSEMessageMap,
>(
  stateStore: StateStorePort,
  ctx: PhaseEmitterContext,
  options: PhaseEmitterOptions<TPhase, TStatus, TMessageType>,
): PhaseEmitter<TPhase, TStatus> {
  const now = options.now ?? Date.now;
  const component = options.component ?? 'PhaseEmitter';
  const dedup: DedupState<TPhase, TStatus> = {
    lastPhase: null,
    lastStatus: null,
    lastThrottledAt: 0,
  };

  return {
    async emit(phase, status, detail) {
      const t = now();

      // Dedup: identical (phase, status) is a no-op unless the throttle window
      // for this phase has elapsed (then we re-emit so elapsed counters tick).
      if (dedup.lastPhase === phase && dedup.lastStatus === status) {
        const throttleMs = options.throttle?.(phase);
        if (!throttleMs || t - dedup.lastThrottledAt < throttleMs) return;
      }

      dedup.lastPhase = phase;
      dedup.lastStatus = status;
      if (options.throttle?.(phase)) dedup.lastThrottledAt = t;

      const channel = getRealtimeBroadcastChannel(
        ctx.userContext.organizationId,
        ctx.userContext.userId,
      );
      const data = options.buildData({
        phase,
        status,
        sessionKey: ctx.sessionKey,
        elapsedMs: t - ctx.startedAt,
        ...(detail !== undefined ? { detail } : {}),
      });

      try {
        await stateStore.publish(channel, { type: options.messageType, data });
      } catch (err: any) {
        logger.warn(`${options.messageType} publish failed (cosmetic — ignored): ${err?.message ?? err}`, {
          component,
        });
      }
    },
  };
}
