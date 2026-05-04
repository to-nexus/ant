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
 * classify — per-task scheduling role:
 *   - isTokens — priority ∈ [100, 199]. Semantically "pre-foundation,
 *     highest priority". In the code job the foundation gate
 *     (`hasPreFeatureWork`) blocks tasks at the feature band (300+) —
 *     setup tasks (100–189) MUST slip through this gate. The gate's
 *     condition is `!isFoundation ∧ !isTokens`; isTokens=true lets
 *     setup pass. Without this, a monorepo queue `[setup-root@100
 *     (exclusive), setup-pkg1@101, setup-pkg2@102, design-system@200,
 *     feature@300]` deadlocks: after setup-root completes, setup-pkg1
 *     cannot dequeue because design-system@200 is queued (activates
 *     `hasPreFeatureWork`) and setup-pkg1 would otherwise be blocked.
 *
 *   The `isTokens` name comes from the design-job semantic (tokens at
 *   100-199, assets at 200-299, spec at 300+). Code-job setup at 100-189
 *   shares the priority-ordering band — both jobs use classify.isTokens
 *   to mean "below-foundation, runs first". Setup never exceeds 189 in
 *   the code job's decompose rules; the classify check covers 190-199
 *   defensively for any future band extension.
 *
 * Introduced in T6b-ε to replace the `task.type === 'setup'` reference
 * inside `isFeatureOrSetupTask` / `isPreDocTask` module-level predicates
 * in `parallel/TaskOrchestrator.ts`. classify extension added as part
 * of the D31 classify-first phase-layer sweep.
 */

import type { BaseTask } from '@ant/shared';
import type { SchedulingClassification } from '../../_shared/types';

export const blocksUi = true;
export const blocksTestgen = true;
export const blocksDoc = true;

export function classify(task: Pick<BaseTask, 'priority'>): SchedulingClassification {
  const p = task.priority;
  return {
    isTokens: p >= 100 && p <= 199,
  };
}
