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
import { isVerificationTask } from '../../verification';

/**
 * Feature tasks are not exclusive by type. Priority-1000 (final
 * verification) is a historical alias that decompose re-types to
 * `'verification'` at normalisation time. This hook is invoked BEFORE
 * the retyping step, so returning `true` when `isVerificationTask`
 * (which recognises both `type === 'verification'` and the priority=1000
 * alias) is the defensive regression guard: if retyping is ever
 * skipped or reordered, the priority-1000 task would stay
 * `type: 'feature'` but still be marked exclusive, preserving the
 * barrier semantics.
 */
export function isExclusive(task: CodeTask): boolean {
  return isVerificationTask(task);
}
