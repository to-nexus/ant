/**
 * setup/hooks/scheduling.ts — TaskSchedulingHook
 *
 * Setup tasks install dependencies and scaffold configs — they run
 * FIRST (priority 100–189) and block downstream work of several types:
 *
 *   - blocksUi      — UI tasks can't render until setup leaves a stable
 *                     workspace / package manifest.
 *   - blocksTestgen — test-code tasks can't target a codebase whose
 *                     test runner config is still being scaffolded.
 *   - blocksDoc     — doc tasks describe the final project layout;
 *                     they wait for setup to finish so the docs are
 *                     accurate.
 *
 * classify — type-fixed scheduling role (Three-Axis SSOT):
 *   - isTokens — every setup task is "below-foundation, runs first".
 *     The foundation gate (`hasPreFeatureWork`) blocks tasks at the
 *     feature band (300+); setup tasks MUST slip through this gate.
 *     The gate's condition is `!isFoundation ∧ !isTokens`; isTokens=true
 *     lets setup pass. Without this, a monorepo queue
 *     `[setup-root@100 (exclusive), setup-pkg1@101, design-system@200,
 *     feature@300]` deadlocks: after setup-root completes, setup-pkg1
 *     cannot dequeue because design-system@200 is queued (activates
 *     `hasPreFeatureWork`).
 *
 *   The `isTokens` name comes from the design-job semantic (tokens at
 *   100-199, assets at 200-299, spec at 300+). Both jobs use
 *   classify.isTokens to mean "below-foundation, runs first".
 */

import type { SchedulingClassification } from '../../_shared/types';

export const blocksUi = true;
export const blocksTestgen = true;
export const blocksDoc = true;

// Three-Axis SSOT: setup is type-fixed — every setup task is the
// "below-foundation, runs first" cohort. Classify ignores its argument
// because the discriminator is the `type` field itself, not a sub-band.
export function classify(): SchedulingClassification {
  // `producesSeamGate`: setup is authoring (scaffolds the packages the seam
  // pass closes over). Seam runs AFTER ui, long after setup, but keeping the
  // flag uniform across all authoring bundles makes the seam barrier robust to
  // any concurrent late-setup edge.
  return { isTokens: true, producesSeamGate: true };
}
