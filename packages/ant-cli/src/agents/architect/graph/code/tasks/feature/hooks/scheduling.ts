/**
 * feature/hooks/scheduling.ts — TaskSchedulingHook
 *
 * Three-Axis SSOT (`AGENTS.md` "Three-Axis Task Modeling"):
 * feature is the only bundle whose scheduling sub-classification is
 * carried on a separate `band` field — `'foundation'` / `'integration'`
 * / `undefined`. The decompose `priority → band` mapping site
 * (`responseParser.ts`) is the one phase location that translates
 * priority into band; classify reads `task.band` only.
 *
 * Consumer flag (feature task is BLOCKED by which barrier):
 *   - preIntegrationBarrier — integration band feature tasks wait for
 *     all non-integration feature work to finish before they can wire
 *     components together. Paired with classify's
 *     `consumesIntegrationGate` flag.
 *
 * Producer flags (feature work ACTIVATES these barriers for other types):
 *   - blocksUi           — ui tasks wait for feature work to finish.
 *   - blocksTestgen      — test-code tasks wait so tests see stable source.
 *   - blocksDoc          — doc tasks wait so docs describe the final shape.
 *   - blocksIntegration  — non-integration feature work gates integration-
 *                          band work (paired with classify's per-task
 *                          `producesIntegrationGate`).
 *
 * classify — band-driven scheduling role:
 *   - isFoundation              — `band === 'foundation'`. Activates
 *                                 `hasPreFeatureWork` barrier.
 *   - isPlatform                — `band === 'platform'`. Activates the
 *                                 `hasPrePlatformWork` barrier (shared runtime
 *                                 services run after foundation, before
 *                                 ordinary feature consumers).
 *   - producesIntegrationGate   — `band === undefined` (ordinary feature).
 *                                 Activates `hasPreIntegrationWork`.
 *   - consumesIntegrationGate   — `band === 'integration'`. Waits on
 *                                 `hasPreIntegrationWork`.
 *   - expandedRagQuota          — foundation OR integration — both need
 *                                 broader codebase visibility in RAG.
 *
 * Pre-three-axis: classify read `task.priority` and the priority window
 * crossings (`Math.max(1, parent - 1)` in `batchSplit`) caused
 * deadlocks when a foundation parent (priority 200) split into
 * priority-199 sub-tasks that were classified as ordinary feature work
 * — leaving the orchestrator with `hasPreFeatureWork=true` (parent
 * still queued) but no remaining task that satisfied the foundation
 * gate. Carrying `band` on the discriminator field makes classify
 * deadlock-immune: sub-tasks inherit `band` from the parent regardless
 * of priority transformations.
 */

import type { BaseTask } from '@ant/shared';
import type { SchedulingClassification } from '../../_shared/types';

export const preIntegrationBarrier = true;

export const blocksUi = true;
export const blocksTestgen = true;
export const blocksDoc = true;
export const blocksIntegration = true;

export function classify(task: BaseTask): SchedulingClassification {
  // Narrow to feature variant: `band` is type-bound to FeatureTask.
  // The orchestrator's `schedClassify` only invokes a bundle's classify
  // for tasks of its own type, so this narrowing is total in practice.
  const band = task.type === 'feature' ? task.band : undefined;
  const isFoundation = band === 'foundation';
  const isPlatform = band === 'platform';
  const consumesIntegrationGate = band === 'integration';
  // Only ordinary feature work (band undefined) produces the integration gate.
  // Platform runs before features, so it finishes long before integration.
  const producesIntegrationGate = band === undefined;
  return {
    isFoundation,
    isPlatform,
    producesIntegrationGate,
    consumesIntegrationGate,
    expandedRagQuota: isFoundation || isPlatform || consumesIntegrationGate,
  };
}
