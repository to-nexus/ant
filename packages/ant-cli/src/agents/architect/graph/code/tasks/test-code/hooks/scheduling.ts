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
 * Intentionally unpublished:
 *   - preUiBarrier / preDocBarrier / preIntegrationBarrier — test-code
 *     only blocks on testgen; it runs after feature/setup but does not
 *     need to wait on ui / doc / integration work.
 *   - blocksUi / blocksTestgen / blocksIntegration — test-code does not
 *     gate those barriers. In particular blocksTestgen=false prevents
 *     self-blocking (a test-code task would otherwise block sibling
 *     test-code tasks from being scheduled in parallel). Regression
 *     guard: the registry test locks each of these to `undefined`.
 *
 * Introduced in T6b-ε — `blocksDoc` replaced the hardcoded
 * `task.type === 'test-code'` reference inside the `isPreDocTask`
 * module-level predicate in `parallel/TaskOrchestrator.ts`.
 */

export const preTestgenBarrier = true;

export const blocksDoc = true;
