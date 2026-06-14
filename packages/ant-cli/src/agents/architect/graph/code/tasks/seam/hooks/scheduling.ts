/**
 * seam/hooks/scheduling.ts — TaskSchedulingHook
 *
 * Seam tasks (cross-feature reference + affordance closure) run AFTER all
 * authoring (setup / foundation / platform / feature / integration / ui) over
 * the materialized graph, and BEFORE test-code / doc / verification so those
 * observe the reference-closed graph.
 *
 * Consumer flag (seam task is BLOCKED by which barrier):
 *   - preSeamBarrier — seam waits for the `hasPreSeamWork` barrier (any task
 *     whose bundle reports `classify.producesSeamGate` — every authoring
 *     bundle). The whole materialized graph, including ui-introduced
 *     affordances, must exist before closure.
 *
 * Producer flags (seam work ACTIVATES these barriers for other types):
 *   - blocksTestgen — test-code waits for seam so generated tests target the
 *     reference-closed graph.
 *   - blocksDoc     — doc waits for seam so docs describe the final, closed shape.
 *
 * classify — seam scheduling role:
 *   - consumesSeamGate — waits on `hasPreSeamWork`. Seam does NOT set
 *     `producesSeamGate`, so seam sub-slices never block one another (no
 *     deadlock; mirrors the integration gate's producer/consumer split).
 *   - expandedRagQuota — seam reads across the module's full reference graph,
 *     so it benefits from broader codebase visibility in RAG.
 *
 * Intentionally unpublished:
 *   - blocksUi — seam runs AFTER ui; it MUST NOT block ui (would deadlock,
 *     since ui produces the seam gate that seam waits on). The registry test
 *     locks this to `undefined`.
 *   - preUiBarrier / preTestgenBarrier / preDocBarrier / preIntegrationBarrier
 *     — seam consumes ONLY the seam barrier.
 */

import type { SchedulingClassification } from '../../_shared/types';

export const preSeamBarrier = true;

export const blocksTestgen = true;
export const blocksDoc = true;

export function classify(): SchedulingClassification {
  return { consumesSeamGate: true, expandedRagQuota: true };
}
