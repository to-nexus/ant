/**
 * ui/hooks/scheduling.ts — TaskSchedulingHook (consumer-only)
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
 * `setup` + `feature`). UI itself never produces a barrier — it is a
 * barrier sink only, so no `blocksUi / blocksTestgen / blocksDoc /
 * blocksIntegration` flags are exported here. The registry test locks
 * this invariant.
 */

export const preUiBarrier = true;
