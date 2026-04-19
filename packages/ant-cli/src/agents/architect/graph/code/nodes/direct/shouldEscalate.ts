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
 * - caller MUST gate the call with `!state._promotedThisJob` so promotion
 *   happens at most once per job. When this predicate is true the caller
 *   returns `{ needsEscalation: true, _promotedThisJob: true, ... }`.
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
