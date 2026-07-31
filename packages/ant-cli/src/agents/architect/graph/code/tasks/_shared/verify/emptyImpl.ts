import type { CodeTask } from '../../../../../types/task';
import { stripMarkdownFences } from '../batchSplit/parse';
import { isVerificationTask } from '../../verification';
import { planDeclaresNoWork } from '../../../planContract/implementation';

/**
 * Plan JSON that declares no work at all — no entry under any mutation key and
 * no fan-out. Lets the plan node flip `done:true` so planRouter short-circuits
 * to `checkTaskStatus` without an execute round-trip.
 *
 * The emptiness decision itself belongs to `planContract/implementation.ts`;
 * this function only owns the "parse a planText string" half. Re-enumerating
 * the keys here is what let this predicate go `assets`-blind while the prompt
 * taught `assets` as legal (level-dashing-plumb).
 */
export function hasEmptyImplementation(planText: string | undefined): boolean {
  if (!planText) return false;
  const body = stripMarkdownFences(planText);
  if (!body.length) return false;
  try {
    return planDeclaresNoWork(JSON.parse(body));
  } catch {
    return false;
  }
}

/**
 * Verification task whose plan-tool loop produced an empty plan and did not
 * batch-split. Treated as "no fixes needed" → done. The LLM is the sole
 * judge of whether gates pass (Session.isComplete() was retired by
 * plan §5.4 — verification cycle progression is conversation-history
 * driven). Caller forwards `task` directly to avoid `state.currentTask`
 * race windows on fresh entry.
 */
export function isVerificationPassWithoutCodeGen(
  task: CodeTask,
  planText: string,
  batchSplitOccurred: boolean,
): boolean {
  if (batchSplitOccurred) return false;
  if (planText !== '') return false;
  if (!isVerificationTask(task)) return false;
  return true;
}
