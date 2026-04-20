/**
 * doc/hooks/scheduling.ts — TaskSchedulingHook (consumer-only)
 *
 * Doc tasks describe the code that was written, so they must wait for
 * feature + setup + test-code work to finish before they have anything
 * stable to document. They publish the `preDocBarrier` consumer flag so
 * the orchestrator gates them behind the cross-type `hasPreDocWork`
 * barrier:
 *
 *     const sched = hooksForTaskType(task.type)?.scheduling;
 *     if (hasPreDocWork && sched?.preDocBarrier) break;
 *
 * (`parallel/TaskOrchestrator.ts` assignNextReadyTask / spawnAvailableWorkers.)
 *
 * Who activates `hasPreDocWork` is a producer-side concern and lives on
 * each upstream bundle's `scheduling.blocksDoc` flag (currently:
 * `setup` + `feature` + `test-code`).
 *
 * Intentionally unpublished:
 *   - preUiBarrier / preTestgenBarrier / preIntegrationBarrier — doc is
 *     sequenced strictly after the `blocksDoc` producers; it does not
 *     consume the ui / testgen / integration barriers.
 *   - blocksUi / blocksTestgen / blocksDoc / blocksIntegration — doc is
 *     a barrier sink only. In particular `blocksDoc=undefined` is a
 *     deliberate regression guard: self-activation would make sibling
 *     doc tasks block each other from parallel scheduling. The registry
 *     test locks each of these to `undefined`.
 *
 * History — prior to T6b-ε the orchestrator carried an inline
 * `hasPreDocWork && task.type === 'doc'` comparison at two assign/peek
 * sites; T6b-ε flipped both sites to consult `sched?.preDocBarrier`,
 * making this flag the SSOT for the doc consumer barrier.
 */

export const preDocBarrier = true;
