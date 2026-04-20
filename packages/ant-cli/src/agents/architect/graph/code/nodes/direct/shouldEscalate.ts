/**
 * shouldEscalate — runtime promotion predicate for the direct ReAct loop.
 *
 * Evaluates whether an in-progress `direct` invocation should be promoted
 * back to `decompose` for full todo planning. The predicate is called by
 * the direct node after each tool batch (and the caller also honours the
 * `<needsEscalation>` LLM signal separately).
 *
 * Triggers (OR):
 * - touched file count exceeds PROMOTION_TOUCHED_THRESHOLD (`touched.length > N`)
 *
 * Guarding (caller responsibility):
 * - caller MUST gate the call with its local `effectivePromoted` (not
 *   `state._promotedThisJob` directly) so promotion happens at most once
 *   per job. `effectivePromoted` is derived at direct-node entry as
 *   `state._promotedThisJob === true || (state.needsEscalation === true
 *   && state._promotedThisJob !== true)` and is also the value persisted
 *   back on return. Setting the flag atomically with the first escalation
 *   would defeat the router's `!_promotedThisJob` branch before decompose
 *   has a chance to re-plan.
 */
import { PROMOTION_TOUCHED_THRESHOLD } from '@ant/shared';
import type { ArchitectGraphState } from '../../state';

export interface ShouldEscalateOptions {
  /** Override threshold; falls back to PROMOTION_TOUCHED_THRESHOLD. */
  touchedThreshold?: number;
}

export function shouldEscalate(
  _state: ArchitectGraphState,
  touched: Iterable<string>,
  opts: ShouldEscalateOptions = {},
): boolean {
  const threshold = opts.touchedThreshold ?? PROMOTION_TOUCHED_THRESHOLD;
  let count = 0;
  for (const _path of touched) {
    count += 1;
    if (count > threshold) return true;
  }
  return false;
}
