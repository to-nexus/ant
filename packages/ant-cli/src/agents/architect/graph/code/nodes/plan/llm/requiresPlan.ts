/**
 * `taskRequiresPlan` — predicate gate for plan-text generation.
 *
 * Tasks that skip planning (LLM never produces a `planText` here; execute
 * node drives directly) publish `plan.requiresPlanText: false` on their
 * task hook bundle. Currently:
 *   - verification (final pass — diagnostics drive remediation, not a plan)
 *   - doc          (documentation tasks render without a plan stage)
 *   - explain      (response-only mode; no implementation plan needed)
 *
 * R1 — phase layer dispatches via `hooksForTaskType(task.type)?.plan?.
 * requiresPlanText` so the literal `task.type === ...` predicates live
 * only inside `tasks/{type}/model/is.ts` (consumed by each bundle when
 * declaring the flag).
 *
 * The `FINAL_VERIFICATION` priority guard is kept as a defence against
 * dynamically-constructed tasks whose `type` is missing — such tasks
 * would otherwise fall through to the default `true` branch and
 * re-introduce planText generation for what `isVerificationTask`
 * (priority-based) already classifies as final verification.
 */

import { TASK_PRIORITIES } from "../../../state";
import { CodeTask } from "../../../../../types/task";
import { hooksForTaskType } from "../../../tasks/_shared/registry";

export function taskRequiresPlan(task: CodeTask): boolean {
  if (task.priority === TASK_PRIORITIES.FINAL_VERIFICATION) return false;
  return hooksForTaskType(task.type)?.plan?.requiresPlanText ?? true;
}
