/**
 * Strict verification-task classification.
 *
 * Replaces the overloaded `utils/taskClassification.isVerificationTask`
 * which also returned true for `task.type === 'error'`. That overload is
 * migrated to `tasks/_shared/classification.isDiagnosticTask` so each
 * caller can pick the precise semantic it needs.
 *
 * R2 coupling note — this module imports the `TASK_PRIORITIES` value map
 * from `graph/code/state.ts`. `state.ts` itself type-imports
 * `VerificationSession`, so the back edge is type-only and erased at
 * runtime; there is no runtime cycle. Structurally this is a pragmatic
 * coupling shared with other task modules (e.g. `tasks/feature/hooks/*`)
 * that also consume `TASK_PRIORITIES`. A strict R2 separation would
 * extract `TASK_PRIORITIES` to a neutral constants module; that
 * refactor is tracked separately and is out of T3 scope because it
 * touches every task folder at once.
 */

import { TASK_PRIORITIES } from '../../../state';

/** Minimal shape needed to classify — avoids depending on the full `CodeTask`. */
export interface TaskClassifyLike {
  priority?: number;
  type?: string;
  name?: string;
}

/**
 * A verification task is:
 *   - `type === 'verification'`, OR
 *   - any task whose priority reaches the `FINAL_VERIFICATION` band, OR
 *   - a task whose name contains a verification keyword (legacy fallback
 *     for scenario fixtures that predate explicit typing).
 *
 * Unlike the legacy helper, `type === 'error'` does NOT qualify. Callers
 * that want the disjunction should use `isDiagnosticTask` from
 * `tasks/_shared/classification.ts`.
 */
export function isVerificationTask(task: TaskClassifyLike | null | undefined): boolean {
  if (!task) return false;
  if (task.type === 'verification') return true;
  if (task.priority != null && task.priority >= TASK_PRIORITIES.FINAL_VERIFICATION) return true;
  const name = task.name?.toLowerCase() ?? '';
  return ['final', 'integration', 'verification'].some(k => name.includes(k));
}

/**
 * Strictly the final verification pass (one per job). Narrower than
 * `isVerificationTask` — ignores keyword-only matches.
 */
export function isFinalVerificationTask(task: TaskClassifyLike | null | undefined): boolean {
  if (!task) return false;
  if (task.type === 'verification') return true;
  return task.priority != null && task.priority >= TASK_PRIORITIES.FINAL_VERIFICATION;
}
