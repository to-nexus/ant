/**
 * test-code/hooks/scheduling.ts — TaskSchedulingHook
 *
 * Consumer flag (test-code task is BLOCKED by which barrier):
 *   - preTestgenBarrier — test-code generation waits until the setup +
 *     feature + ui work it is testing against is complete; otherwise the
 *     generator races against still-moving source / view files. The
 *     producers that activate `hasPreTestgenWork` live on each upstream
 *     bundle's `scheduling.blocksTestgen` flag (`setup` + `feature` +
 *     `ui`). ui was added so tests target fully-built views, not
 *     half-rendered components.
 *
 * Producer flag (test-code work ACTIVATES this barrier for other types):
 *   - blocksDoc — doc tasks wait until test-code work finishes so the
 *     docs describe the final test layout alongside the final source.
 *
 * Intentionally unpublished:
 *   - preUiBarrier / preDocBarrier / preIntegrationBarrier — test-code
 *     consumes ONLY the testgen barrier. Note it still waits for ui, but
 *     via ui's `blocksTestgen` producer (→ the testgen barrier), NOT by
 *     consuming a preUiBarrier here. It does not wait on doc / integration.
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
