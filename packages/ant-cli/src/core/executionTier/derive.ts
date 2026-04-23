/**
 * core/executionTier/derive — helpers to derive execution-path labels
 * from the 5-tier ExecutionTier SSOT.
 *
 * `state.executionTier` is the single LLM-judged signal. The legacy
 * `complexity` field has been removed from the system; consumers that
 * need to distinguish direct vs task path use these tier-range helpers.
 *
 * Boundary SSOT (Tier-Verification Alignment Phase 1):
 *   Tier 0 Reflex     → direct, read-only answer
 *   Tier 1 OneShot    → direct, verification-unneeded write (comment/typo/safe)
 *   Tier 2 Exploratory → task path, exactly 1 task with selfVerifyOnDone
 *                        (single unit of work, task owns inline verification)
 *   Tier 3 Task       → task path, >= 2 tasks with mandatory verification task
 *   Tier 4 RefsGrounded → task path, >= 2 tasks with mandatory verification task
 *
 * Direct / task boundary:
 *   `isDirectTier(tier) = tier <= 1` — Tier 0 & 1 run the direct ReAct loop.
 *   `isTaskTier(tier)   = tier >= 2` — Tier 2, 3, 4 all route through the
 *                                      plan/execute pipeline.
 *
 * The historical boundary (`tier <= 2 → direct`) was retired because a
 * Tier-2 "single unit of work" and a Tier-3 "1-task breakdown" encoded
 * the same situation via two different code paths. Folding n=1 into
 * Tier 2 (task path) eliminates that fragmentation while Tier 0/1 keep
 * the lightweight direct loop for read-only / verification-unneeded
 * cases.
 */

import type { ExecutionTierId } from './types';

/**
 * Tier → direct-node loop mode. Used by the `direct` node to pick the
 * ReAct loop upper bound:
 *
 *   Tier 0     → undefined      (no-tool answer; direct returns after the
 *                                first assistant turn when tools aren't
 *                                issued)
 *   Tier 1     → 'oneshot'      (DIRECT_LOOP_LIMITS.oneshot — up to 2
 *                                steps for a verification-unneeded write)
 *   Tier 2+    → undefined      (task path, direct does not apply)
 */
export function tierToDirectMode(
  tier: ExecutionTierId,
): 'oneshot' | 'exploratory' | undefined {
  if (tier === 0) return undefined;
  if (tier === 1) return 'oneshot';
  return undefined;
}

/**
 * `true` iff tier selects the direct (non-task) execution path.
 * Short-hand for `tier <= 1`.
 */
export function isDirectTier(tier: ExecutionTierId): boolean {
  return tier <= 1;
}

/**
 * `true` iff tier selects the task pipeline path (plan → execute →
 * checkTaskStatus). Short-hand for `tier >= 2`.
 */
export function isTaskTier(tier: ExecutionTierId): boolean {
  return tier >= 2;
}
