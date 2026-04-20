/**
 * feature/hooks/decompose.ts — TaskDecomposeHook
 *
 * Feature tasks are the only multi-task type that is NOT exclusive:
 * they are designed to run in parallel via `parallelGroup`. The
 * `isTypeExclusive` fallback in `nodes/decompose/responseParser.ts`
 * L358 only marks setup / error / verification / priority===1000 as
 * exclusive; feature tasks fall through to the `false` branch.
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
 * `'verification'` at normalisation time (see responseParser.ts L367
 * `resolvedType`); if that retyping is ever skipped, fall back to
 * exclusive so behaviour does not regress.
 */
export function isExclusive(task: CodeTask): boolean {
  return task.priority === TASK_PRIORITIES.FINAL_VERIFICATION;
}
