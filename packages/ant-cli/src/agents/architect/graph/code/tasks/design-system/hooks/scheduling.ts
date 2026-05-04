/**
 * design-system/hooks/scheduling.ts — TaskSchedulingHook
 *
 * Design-system tasks in the code pipeline build the visual infrastructure
 * (token → CSS bridge at priority 200, shared component library at
 * priority 201+, all sharing `parallelGroup: "design-system"`). Their
 * ordering relative to feature work is enforced through `classify`:
 *
 *   classify.isFoundation       — priority ∈ [SHARED_FOUNDATION,
 *                                 FOUNDATION_MAX]. Activates
 *                                 `hasPreFeatureWork` barrier so
 *                                 priority >= 300 (feature / ui /
 *                                 test-code / doc / integration) waits
 *                                 for design-system tokens/wiring.
 *   classify.expandedRagQuota   — same band; foundation work benefits
 *                                 from broader codebase visibility in
 *                                 RAG.
 *
 * Within-bundle ordering uses `parallelGroup: "design-system"` plus the
 * priority-ordered queue (200 tokens → 201+ wiring).
 *
 * Intentionally absent:
 *   - preUiBarrier / preTestgenBarrier / preDocBarrier /
 *     preIntegrationBarrier — design-system never consumes a type-level
 *     barrier; its turn comes before any of those consumer bands.
 *   - blocksUi / blocksTestgen / blocksDoc / blocksIntegration — the
 *     "design-system blocks priority ≥ 300 tasks" semantic is expressed
 *     by the classify-driven `isFoundation` flag. Publishing a separate
 *     `blocksXxx` flag would create dual SSOT (hook flag vs classify
 *     band) — intentionally omitted.
 *
 * History — this module previously published NO scheduling slot at all
 * (the bundle deliberately left scheduling undefined so the orchestrator
 * would fall back to a hard-coded `isFoundationTask` priority window).
 * That inlined predicate was the R1 residual: phase layer compared raw
 * priority bands instead of delegating to the bundle. classify closes
 * that gap — the bundle now OWNS the "priority 200–299 means foundation"
 * semantic, and the orchestrator asks via
 * `hooksForTaskType('design-system')?.scheduling?.classify?.(t)?.isFoundation`.
 */

import type { BaseTask } from '@ant/shared';
import type { SchedulingClassification } from '../../_shared/types';
import { TASK_PRIORITIES } from '../../../state';

export function classify(task: Pick<BaseTask, 'priority'>): SchedulingClassification {
  const p = task.priority;
  const isFoundation =
    p >= TASK_PRIORITIES.SHARED_FOUNDATION && p <= TASK_PRIORITIES.FOUNDATION_MAX;
  return {
    isFoundation,
    expandedRagQuota: isFoundation,
  };
}
