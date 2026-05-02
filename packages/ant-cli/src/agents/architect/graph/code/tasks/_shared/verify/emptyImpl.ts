import type { CodeTask } from '../../../../../types/task';
import { stripMarkdownFences } from '../batchSplit/parse';
import { isVerificationTask } from '../../verification';

/**
 * Plan JSON whose implementation is literally empty (no modify/create/delete
 * and no batches). Lets the plan node flip `done:true` so planRouter
 * short-circuits to `checkTaskStatus` without an execute round-trip.
 */
export function hasEmptyImplementation(planText: string | undefined): boolean {
  if (!planText) return false;
  const body = stripMarkdownFences(planText);
  if (!body.length) return false;
  try {
    const parsed = JSON.parse(body);
    const impl = parsed.implementation || {};
    const modifyCount = Array.isArray(impl.modify) ? impl.modify.length : 0;
    const createCount = Array.isArray(impl.create) ? impl.create.length : 0;
    const deleteCount = Array.isArray(impl.delete) ? impl.delete.length : 0;
    const hasBatches = Array.isArray(parsed.batches) && parsed.batches.length > 0;
    return !hasBatches && modifyCount === 0 && createCount === 0 && deleteCount === 0;
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
