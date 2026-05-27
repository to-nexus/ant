/**
 * Plan detect augment — executionTier selector.
 *
 * Phase C SSOT split — the job-blind `inferRacWithTools` produces RAC slots
 * + progressibility status; planner-plan still needs to assign an
 * `executionTier` after detect (because the plan job has no decompose
 * tier-entry node — detect is its tier entry). This hook bridges the gap.
 *
 * Selection logic (preserved from the legacy `planDetectStrategy`):
 *   - intent === 'gen-plan' / 'rev-plan' → Reflex (Tier 0). The plan node
 *     itself plans the document; no expansion is needed.
 *   - intent === 'explain-plan'          → Reflex. Read-only summary.
 *
 * Future expansion (multi-tier plan flows) lives here, not in detect core.
 */

import { ExecutionTierId } from '../../../../../../core/executionTier/index.js';
import type { DetectAugment } from '../../../../../common/graph/nodes/detect/types.js';
import type { PlanGraphState } from '../../state.js';

export const augmentPlanExecutionTier: DetectAugment<PlanGraphState> = async ({
  detectResult,
}) => {
  // detect produced a non-proceed verdict (blocked / redirect-suggested) —
  // there is no work to schedule yet, so we do not pick a tier. The Phase D
  // routing layer ends the graph in that case.
  if (detectResult.status !== 'proceed') return {};

  return {
    stateUpdates: {
      executionTier: ExecutionTierId.Reflex,
    } as Partial<PlanGraphState>,
  };
};
