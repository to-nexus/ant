/**
 * feature/hooks/decompose.ts — TaskDecomposeHook.isExclusive
 *
 * Called from `nodes/decompose/responseParser.ts` (currently L383–385)
 * via the `hooksForTaskType(task.type)?.decompose?.isExclusive?.(task)
 * ?? false` dispatch — there is no inline if-chain over `task.type` at
 * the call site, the phase layer is blind (R1). Every task type
 * resolves its own exclusivity here: setup / error / verification all
 * return `true`; ui / design-system / test-code / doc omit the hook
 * entirely and the `?? false` fallback applies; feature is the one
 * multi-task type that is NOT exclusive by default so it can run in
 * parallel via `parallelGroup`.
 *
 * This hook documents the invariant explicitly so future callers
 * cannot accidentally flip the default by mis-editing the fallback.
 * It intentionally returns `false` even for high-priority integration
 * tasks — integration ordering is handled by the preIntegrationBarrier
 * scheduling hook, not by exclusive marking.
 */

import type { CodeTask } from '../../../../../types/task';
import { TASK_PRIORITIES } from '../../../state';

/**
 * Feature tasks are not exclusive by type. Priority-1000 (final
 * verification) is a historical alias that decompose re-types to
 * `'verification'` at normalisation time (see `responseParser.ts`
 * L393–394 `resolvedType`). This hook is invoked BEFORE the retyping
 * step (at L383–385 on the still-`'feature'` task), so returning
 * `true` for `priority === FINAL_VERIFICATION` is the defensive
 * regression guard: if the retyping step is ever skipped or reordered,
 * the priority-1000 task would stay `type: 'feature'` but still be
 * marked exclusive, preserving the barrier semantics.
 */
export function isExclusive(task: CodeTask): boolean {
  return task.priority === TASK_PRIORITIES.FINAL_VERIFICATION;
}
