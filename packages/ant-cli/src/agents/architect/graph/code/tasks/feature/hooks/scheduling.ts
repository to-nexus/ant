/**
 * feature/hooks/scheduling.ts — TaskSchedulingHook
 *
 * Consumer flag (feature task is BLOCKED by which barrier):
 *   - preIntegrationBarrier — integration-priority feature tasks wait for
 *     all non-integration feature work to finish before they can wire
 *     components together. Paired with the orchestrator's classify-driven
 *     `consumesIntegrationGate` check.
 *
 * Producer flags (feature work ACTIVATES these barriers for other types):
 *   - blocksUi           — ui tasks wait for feature work to finish
 *                          (UI needs layout/data scaffolding to exist).
 *   - blocksTestgen      — test-code tasks wait for feature work to
 *                          finish so the tests see stable source.
 *   - blocksDoc          — doc tasks wait for feature work to finish so
 *                          the docs describe the final shape.
 *   - blocksIntegration  — non-integration feature work gates
 *                          integration-priority work (paired with the
 *                          classify-driven `producesIntegrationGate` in
 *                          the orchestrator).
 *
 * classify — per-task scheduling role:
 *   - isFoundation              — shared foundation feature tasks
 *                                 (priority ∈ [SHARED_FOUNDATION,
 *                                 FOUNDATION_MAX]). Activates
 *                                 `hasPreFeatureWork` barrier.
 *   - producesIntegrationGate   — non-integration feature work
 *                                 (priority ∈ [FEATURE_CRITICAL,
 *                                 INTEGRATION_MIN)). Activates
 *                                 `hasPreIntegrationWork` barrier.
 *   - consumesIntegrationGate   — integration feature work
 *                                 (priority ∈ [INTEGRATION_MIN,
 *                                 INTEGRATION_MAX]). Waits on
 *                                 `hasPreIntegrationWork` barrier.
 *   - expandedRagQuota          — shared foundation OR integration work
 *                                 — both need broader codebase
 *                                 visibility in RAG.
 *
 * Replaces the module-level predicates `isFeatureOrSetupTask`,
 * `isPreDocTask`, `isNonIntegrationFeatureTask`, and the inline priority
 * window checks (`isFoundationTask`, `isPreIntegrationWork`) that
 * previously compared `task.priority` inline in
 * `parallel/TaskOrchestrator.ts`.
 */

import type { BaseTask } from '@ant/shared';
import type { SchedulingClassification } from '../../_shared/types';
import { TASK_PRIORITIES } from '../../../state';

export const preIntegrationBarrier = true;

export const blocksUi = true;
export const blocksTestgen = true;
export const blocksDoc = true;
export const blocksIntegration = true;

export function classify(task: Pick<BaseTask, 'priority'>): SchedulingClassification {
  const p = task.priority;
  const isFoundation =
    p >= TASK_PRIORITIES.SHARED_FOUNDATION && p <= TASK_PRIORITIES.FOUNDATION_MAX;
  const consumesIntegrationGate =
    p >= TASK_PRIORITIES.INTEGRATION_MIN && p <= TASK_PRIORITIES.INTEGRATION_MAX;
  const producesIntegrationGate =
    p >= TASK_PRIORITIES.FEATURE_CRITICAL && p < TASK_PRIORITIES.INTEGRATION_MIN;
  return {
    isFoundation,
    producesIntegrationGate,
    consumesIntegrationGate,
    expandedRagQuota: isFoundation || consumesIntegrationGate,
  };
}
