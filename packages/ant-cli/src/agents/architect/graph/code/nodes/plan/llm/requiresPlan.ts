/**
 * `taskRequiresPlan` — predicate gate for plan-text generation.
 *
 * Tasks that skip planning (LLM never produces a `planText` here; execute
 * node drives directly):
 *   - verification (final pass — diagnostics drive remediation, not a plan)
 *   - doc          (documentation tasks render without a plan stage)
 *   - explain      (response-only mode; no implementation plan needed)
 *
 * test-code used to live here (R1 residual) but was moved back into the
 * standard plan path in F2 (2026-04 test-code infinite-loop fix) so test
 * authoring benefits from keyword / RAG observation and violation
 * feedback on retry like every other code-writing task.
 *
 * R1 — phase layer delegates to per-task predicates so the
 * literal comparisons live only inside `tasks/{type}/model/is.ts`.
 * The `FINAL_VERIFICATION` priority guard is kept as a defence against
 * dynamically-constructed tasks whose `type` is missing (same pattern
 * as `isVerificationTask`).
 */

import { TASK_PRIORITIES } from "../../../state";
import { CodeTask } from "../../../../../types/task";
import { isVerificationTask } from "../../../tasks/verification";
import { isDocTask } from "../../../tasks/doc/model/is";
import { isExplainTask } from "../../../tasks/explain/model/is";

export function taskRequiresPlan(task: CodeTask): boolean {
  if (task.priority === TASK_PRIORITIES.FINAL_VERIFICATION) return false;
  if (isVerificationTask(task)) return false;
  if (isDocTask(task)) return false;
  if (isExplainTask(task)) return false;
  return true;
}
