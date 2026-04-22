/**
 * plan/parts/planHistory.ts — SSOT helper for recording an applied plan
 * into the verification session's plan-history channel.
 *
 * `state.verification?.onPlanApplied(planText)` is the single writer that
 * populates `session.planHistoryHashes()` (always) and
 * `session.planHistoryBodies()` (only for non-empty bodies). The hash
 * channel is authoritative for repeated-plan / no-progress detection;
 * the body channel is a bounded prompt-injection buffer.
 *
 * Why empty plans are also recorded: the plan LLM sometimes emits
 * `<done>true</done>` with no `<plan>` block mid-retry. That path yields
 * `planText === ''`, and if we silently dropped it the hash channel
 * would never register repetition — `checkRetryTermination`'s
 * `isPlanRepeated` would be blind to "silent give-up" streaks.
 * Recording empty plans in the hash list lets the existing
 * repeated-plan detector fire `no_progress` through its normal path
 * (two consecutive empties hash identically). No parallel counter is
 * introduced.
 *
 * Call sites:
 *   - `nodes/plan/index.ts` — main plan path (fallthrough from tool-loop).
 *   - `nodes/plan/parts/planLLM.ts` — overLimit finalizedPlan short-circuit.
 *   - `nodes/plan/parts/planLLM.ts` — normal planText short-circuit.
 *
 * All three must use this helper so the guard stays consistent (if the
 * condition set grows or shrinks, exactly one place changes).
 */

import type { ArchitectGraphState } from '../../../state';
import type { CodeTask } from '../../../../../types/task';
import { hasEmptyImplementation } from './batchSplit';
import { isVerificationTask } from '../../../tasks/verification';
import { isErrorTask } from '../../../tasks/error';

/**
 * Push `planText` into the verification session's plan-history unless
 * the plan was consumed by a batch split (in which case the fanned-out
 * error sub-tasks carry the intent forward) or by the empty-
 * implementation remediation short-circuit (a valid "no errors" plan
 * JSON that signals completion rather than a new attempt). Returns
 * true when the push happened so callers can use it for logging.
 *
 * `batchSplitOccurred` is the caller's responsibility because only the
 * caller knows whether `processDiagnosticBatchSplit` consumed the plan.
 * `emptyImplShortCircuit` is derived here from `(task, planText)` so
 * callers do not duplicate the `isRemediationTask` + `hasEmptyImplementation`
 * formula.
 */
export function maybeApplyPlanHistory(
  state: ArchitectGraphState,
  planText: string,
  batchSplitOccurred: boolean,
  task: CodeTask,
): boolean {
  if (batchSplitOccurred) return false;
  const isRemediationTask = isVerificationTask(task) || isErrorTask(task);
  const emptyImplShortCircuit = isRemediationTask && hasEmptyImplementation(planText);
  if (emptyImplShortCircuit) return false;
  state.verification?.onPlanApplied(planText);
  return true;
}
