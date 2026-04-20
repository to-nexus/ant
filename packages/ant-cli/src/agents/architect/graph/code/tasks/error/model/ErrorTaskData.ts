/**
 * error/model/ErrorTaskData.ts — read-side accessor for the four
 * error-specific fields that currently live directly on `CodeTask`
 * (`prePlanText`, `errors`, `category`, `remediationMode`).
 *
 * Purpose of this indirection:
 *   - Phase / hook code should never poke at these fields under ad-hoc
 *     casts (`(task as any).errors`). `readErrorData(task)` is the single
 *     read surface so future refactors (e.g. collapsing the four fields
 *     into one payload) touch one file.
 *   - `TaskType === 'error'` is the authoritative discriminator. Callers
 *     that need to branch on presence should still use `isErrorTask` from
 *     `./is.ts`; this module assumes the caller has already narrowed.
 *
 * R2 — model is phase-blind. No imports from `nodes/` / `routers/` /
 * `parallel/`.
 */

import type { CodeTask } from '../../../../../types/task';

export type RemediationMode = 'patch' | 'upstream' | 'refactor';

export interface ErrorTaskData {
  prePlanText?: string;
  errors?: string[];
  category?: string;
  remediationMode?: RemediationMode;
}

/**
 * Extract the four error-task fields as a narrowed view. Every field is
 * optional — error tasks synthesised by decompose often carry only a
 * subset (e.g. only `errors` + `category`).
 */
export function readErrorData(task: CodeTask): ErrorTaskData {
  return {
    prePlanText: task.prePlanText,
    errors: Array.isArray(task.errors) ? task.errors : undefined,
    category: typeof task.category === 'string' ? task.category : undefined,
    remediationMode: task.remediationMode,
  };
}

/** True when the task carries a pre-built plan from a verification batch split. */
export function hasPrePlanText(task: CodeTask): boolean {
  return typeof task.prePlanText === 'string' && task.prePlanText.length > 0;
}
