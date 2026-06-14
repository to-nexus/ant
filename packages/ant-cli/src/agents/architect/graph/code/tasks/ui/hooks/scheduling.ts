/**
 * ui/hooks/scheduling.ts — TaskSchedulingHook
 *
 * UI tasks render the view layer from `uiSections` + design tokens and
 * must wait for foundation (`setup`) and feature scaffolding before
 * they have anything to render. They publish the `preUiBarrier`
 * consumer flag so the orchestrator gates them behind the cross-type
 * `hasPreUiWork` barrier:
 *
 *     const sched = hooksForTaskType(task.type)?.scheduling;
 *     if (hasPreUiWork && sched?.preUiBarrier) break;
 *
 * Who activates `hasPreUiWork` is a producer-side concern and lives on
 * each upstream bundle's `scheduling.blocksUi` flag (currently:
 * `setup` + `feature`).
 *
 * Producer flag (ui work ACTIVATES this barrier for other types):
 *   - blocksTestgen — test-code tasks wait for ui work to finish so the
 *     generated tests target fully-built views, not half-rendered
 *     components. Added alongside setup/feature so test-code runs only
 *     after ALL ordinary implementation (feature + ui) is complete.
 *     doc is gated transitively (doc waits on test-code via blocksDoc).
 *
 * classify — produces the seam gate:
 *   - producesSeamGate — ui is authoring work, and in fact the LAST authoring
 *     layer (it introduces affordances / navigation the feature layer did
 *     not). The `seam` pass (reference + affordance closure, run AFTER ui)
 *     must wait for ui → activates `hasPreSeamWork`. ui does NOT consume the
 *     seam barrier (seam runs after ui), so no `preSeamBarrier` here.
 *
 * Intentionally unpublished:
 *   - blocksUi / blocksDoc / blocksIntegration — ui does not gate those
 *     barriers (no self-block on ui; doc reaches ui transitively through
 *     test-code; integration is a feature-band concern). The registry
 *     test locks each of these to `undefined`.
 */

import type { SchedulingClassification } from '../../_shared/types';

export const preUiBarrier = true;

export const blocksTestgen = true;

export function classify(): SchedulingClassification {
  return { producesSeamGate: true };
}
