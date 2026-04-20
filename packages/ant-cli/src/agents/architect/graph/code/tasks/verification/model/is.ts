/**
 * Verification-task classifier.
 *
 * System invariant: verification tasks are ALWAYS the final verification
 * pass. The decompose prompt spec (`jobs/code/nodes/decompose/variants/
 * default/rules.md` — "1000: verification" single band) and every creation
 * site (`error/hooks/orchestrator.ts onTaskComplete`, LLM decompose output,
 * scenario seeds) co-assign `type: 'verification'` with
 * `priority: TASK_PRIORITIES.FINAL_VERIFICATION`. There is no such thing as
 * a "non-final verification task" in this system — consequently there is
 * no separate `isFinalVerificationTask` predicate. Call sites that used to
 * distinguish "final" from "generic verification" were mirroring a legacy
 * keyword-fallback scenario that never actually existed in production data.
 *
 * Replaces the overloaded `utils/taskClassification.isVerificationTask`
 * which also returned true for `task.type === 'error'`. Since T6b-η there
 * is no "diagnostic" alias; callers that genuinely need "verification OR
 * error" spell the disjunction out. Verification owns build/test/typecheck
 * diagnosis and a `VerificationSession`; error applies fixes from an
 * upstream remediation plan and owns neither.
 *
 * R2 coupling note — this module imports the `TASK_PRIORITIES` value map
 * from `graph/code/state.ts`. `state.ts` itself type-imports
 * `VerificationSession`, so the back edge is type-only and erased at
 * runtime; there is no runtime cycle. Structurally this is a pragmatic
 * coupling shared with other task modules (e.g. `tasks/feature/hooks/*`)
 * that also consume `TASK_PRIORITIES`.
 */

import { TASK_PRIORITIES } from '../../../state';

/** Minimal shape needed to classify — avoids depending on the full `CodeTask`. */
export interface TaskClassifyLike {
  priority?: number;
  type?: string;
  name?: string;
}

/**
 * A verification task is the final-verification pass.
 *
 * Positive when EITHER:
 *   - `type === 'verification'` (the canonical assignment), OR
 *   - `priority >= FINAL_VERIFICATION` (defence against dynamically-
 *     constructed tasks that set the priority without the type).
 *
 * NOT qualifying: `type === 'error'` (a separate remediation task type —
 * see `tasks/error/model/is.ts`). NOT qualifying: task names containing
 * 'final' / 'integration' / 'verification' without the proper
 * type / priority — the legacy keyword fallback was removed in T6b-θ
 * because it produced false positives for ordinary feature / doc tasks
 * whose names coincidentally matched those keywords.
 */
export function isVerificationTask(task: TaskClassifyLike | null | undefined): boolean {
  if (!task) return false;
  if (task.type === 'verification') return true;
  return task.priority != null && task.priority >= TASK_PRIORITIES.FINAL_VERIFICATION;
}
