import type { ArchitectGraphState } from '../../../state';
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
 * After `processDiagnosticBatchSplit` runs, a verification task MUST NOT
 * carry a non-empty planText with surviving top-level implementation
 * entries — the auto-conversion normalises top-level entries into batches
 * and returns `''`. Surviving entries indicate a fan-out conversion
 * regression.
 *
 * Throws on violation; no-op for non-verification, empty, or parse-failure
 * planText. Dev-assist only — production-safe to remove.
 */
export function assertVerificationPlanIsFanoutOnly(
  planText: string,
  task: CodeTask,
): void {
  if (!isVerificationTask(task)) return;
  if (!planText) return;
  let parsed: any;
  try {
    parsed = JSON.parse(stripMarkdownFences(planText));
  } catch {
    return;
  }
  const impl = parsed?.implementation || {};
  const topLevelCount =
    (Array.isArray(impl.modify) ? impl.modify.length : 0) +
    (Array.isArray(impl.create) ? impl.create.length : 0) +
    (Array.isArray(impl.delete) ? impl.delete.length : 0);
  if (topLevelCount === 0) return;
  throw new Error(
    `[BatchSplit invariant] Verification task "${task.name}" produced a planText with ${topLevelCount} top-level implementation entries that survived processDiagnosticBatchSplit. This indicates a fan-out conversion regression — every entry should have been auto-converted to a per-target batch and the planText should be empty.`,
  );
}

/**
 * Verification task whose tool-loop already passed every gate and emitted
 * an empty plan. Lets the plan node return `done:true` directly without a
 * wasted execute call.
 *
 * Verification-only by design: completeness comes from
 * `VerificationSession.isComplete()`, which only verification's
 * `initSession` populates.
 */
export function isVerificationPassWithoutCodeGen(
  state: ArchitectGraphState,
  planText: string,
  batchSplitOccurred: boolean,
): boolean {
  if (batchSplitOccurred) return false;
  if (planText !== '') return false;
  if (!isVerificationTask(state.currentTask)) return false;
  return state.verification?.isComplete() ?? false;
}
