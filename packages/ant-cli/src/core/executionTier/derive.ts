/**
 * core/executionTier/derive — helpers to derive execution-path labels
 * from the 5-tier ExecutionTier SSOT.
 *
 * `state.executionTier` is the single LLM-judged signal. The legacy
 * `complexity` field has been removed from the system; consumers that
 * need to distinguish direct vs task path use these tier-range helpers.
 */

import type { ExecutionTierId } from './types';

/**
 * Tier → direct-node loop mode. Used by the `direct` node to pick the
 * ReAct loop upper bound:
 *
 *   Tier 0, 1 → 'oneshot'      (DIRECT_LOOP_LIMITS.oneshot)
 *   Tier 2    → 'exploratory'  (DIRECT_LOOP_LIMITS.exploratory)
 *   Tier 3, 4 → undefined      (direct path does not apply; plan path takes over)
 */
export function tierToDirectMode(
  tier: ExecutionTierId,
): 'oneshot' | 'exploratory' | undefined {
  if (tier <= 1) return 'oneshot';
  if (tier === 2) return 'exploratory';
  return undefined;
}

/**
 * `true` iff tier selects the direct (non-decompose) execution path.
 * Short-hand for `tier <= 2`.
 */
export function isDirectTier(tier: ExecutionTierId): boolean {
  return tier <= 2;
}

/**
 * `true` iff tier selects the task / plan pipeline path.
 * Short-hand for `tier >= 3`.
 */
export function isTaskTier(tier: ExecutionTierId): boolean {
  return tier >= 3;
}
