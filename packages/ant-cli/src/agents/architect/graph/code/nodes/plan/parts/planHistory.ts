/**
 * plan/parts/planHistory.ts — SSOT helper for recording an applied plan
 * into the verification session's plan-history channel.
 *
 * `state.verification?.onPlanApplied(planText)` is the single writer that
 * populates `session.planHistoryBodies()` / `planHistoryHashes()`. Without
 * it, `buildDiagnosticRetryContext` (nodes/plan/index.ts) returns undefined
 * and retry attempts lose prior-attempt context — `hasViolationsText`
 * stays false and the LLM re-enters with no memory of what it already
 * tried. `checkRetryTermination`'s `isPlanRepeated` also becomes a no-op.
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
 * Push `planText` into the verification session's plan-history iff it is
 * a legitimate finalized plan — non-empty, not a batch-split fanout, not
 * an empty-implementation remediation short-circuit. Returns true when
 * the push happened so callers can use it for logging if needed.
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
  if (!planText || batchSplitOccurred) return false;
  const isRemediationTask = isVerificationTask(task) || isErrorTask(task);
  const emptyImplShortCircuit = isRemediationTask && hasEmptyImplementation(planText);
  if (emptyImplShortCircuit) return false;
  state.verification?.onPlanApplied(planText);
  return true;
}
