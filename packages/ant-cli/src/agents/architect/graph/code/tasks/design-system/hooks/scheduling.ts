/**
 * design-system/hooks/scheduling.ts — TaskSchedulingHook
 *
 * Design-system tasks in the code pipeline build the visual infrastructure
 * (token → CSS bridge, shared component library, all sharing
 * `parallelGroup: "design-system"`). Their ordering relative to feature
 * work is enforced through Three-Axis SSOT — design-system is type-fixed
 * foundation work:
 *
 *   classify.isFoundation       — always true. Activates the
 *                                 `hasPreFeatureWork` barrier so feature
 *                                 / ui / test-code / doc / integration
 *                                 wait for design-system tokens/wiring.
 *   classify.expandedRagQuota   — always true; foundation work benefits
 *                                 from broader codebase visibility in RAG.
 *
 * Within-bundle ordering uses `parallelGroup: "design-system"` plus the
 * priority-ordered queue.
 *
 * Intentionally absent:
 *   - preUiBarrier / preTestgenBarrier / preDocBarrier /
 *     preIntegrationBarrier — design-system never consumes a type-level
 *     barrier; its turn comes before any of those consumer bands.
 *   - blocksUi / blocksTestgen / blocksDoc / blocksIntegration — the
 *     "design-system blocks downstream tasks" semantic is expressed by
 *     classify.isFoundation. Publishing a separate `blocksXxx` flag
 *     would create dual SSOT (hook flag vs classify result) —
 *     intentionally omitted.
 *
 * History — this module previously published no scheduling slot, then
 * gated foundation on a priority window (200–299), then on the
 * Three-Axis SSOT it is type-fixed: every design-system task is
 * foundation work by virtue of its type. Phase layer asks via
 * `hooksForTaskType('design-system')?.scheduling?.classify?.(t)?.isFoundation`.
 */

import type { SchedulingClassification } from '../../_shared/types';

// Three-Axis SSOT: design-system is type-fixed — every design-system task
// is foundation work (visual infrastructure that priority ≥ 300 work
// depends on). Classify ignores its argument because the discriminator
// is the `type` field itself.
export function classify(): SchedulingClassification {
  return {
    isFoundation: true,
    expandedRagQuota: true,
    // Authoring work the `seam` pass (run AFTER ui) waits for. Redundant with
    // the foundation gate while ds runs, but keeps "all authoring produces the
    // seam gate" uniform across bundles.
    producesSeamGate: true,
  };
}
