/**
 * test-code/hooks/scheduling.ts — TaskSchedulingHook
 *
 * Consumer flag (test-code task is BLOCKED by which barrier):
 *   - preTestgenBarrier — test-code generation waits until the feature
 *     + setup work it is testing against is complete; otherwise the
 *     generator races against still-moving source files.
 *
 * Producer flag (test-code work ACTIVATES this barrier for other types):
 *   - blocksDoc — doc tasks wait until test-code work finishes so the
 *     docs describe the final test layout alongside the final source.
 *
 * Introduced in T6b-ε — `blocksDoc` replaces the `task.type === 'test-code'`
 * reference inside the `isPreDocTask` module-level predicate in
 * `parallel/TaskOrchestrator.ts`.
 */

export const preTestgenBarrier = true;

export const blocksDoc = true;
