/**
 * Plan Router - pure predicate on plan node output.
 *
 * R1 — the router is a read-only function of `state`. Any short-circuit
 * `llmResponse.done` flag was already set by the plan node (see handoff
 * §7.5 / T6b-α). Router responsibilities:
 *
 *   1. Plan node signalled done (batch split / diagnostic pass / empty
 *      implementation) → checkTaskStatus.
 *   2. Plan is in its tool loop (tool calls present) → tool, UNLESS a
 *      safety net fires first:
 *      - Safety Net C (plan): `_noProgressStreak ≥ NO_PROGRESS_HARD_CAP` —
 *        the loop's recent batches carried zero new information (dup reads /
 *        repeat errors / repeat commands with identical output). Divert to
 *        checkTaskStatus → `no_done_signal` retryable violation →
 *        fresh-conversation retry. (shy-crushing-bloom: 357 identical test
 *        re-runs rode the raw recursion limit to a whole-job hard interrupt
 *        because the plan loop had NO breaker — every safety net lived in
 *        executeRouter, which the plan↔tool cycle never visits.)
 *      - Safety Net A (plan): verify-mode task near recursion-budget
 *        exhaustion — divert so checkTaskStatus' drain edge lands the task
 *        gracefully (checkpoint + resumable) instead of the LangGraph hard
 *        limit killing the whole job. Unlike execute-side A this fires even
 *        with a pending tool call: past this point every remaining step is
 *        borrowed from the hard cliff.
 *   3. Otherwise (planText ready) → execute.
 *
 * Both breakers live INSIDE the tool-loop branch so they can only divert a
 * would-be tool round — a plan that finalized (planText / batch split) has
 * already had its streak reset by `finalizePlanOutcome` and is never
 * swallowed.
 */

import { ArchitectGraphState, NO_PROGRESS_HARD_CAP, RECURSION_DRAIN_THRESHOLD } from '../state';
import { isVerificationTask } from '../tasks/verification';
import { isVerifyModeActive } from '../tasks/_shared/verify';

export function routeAfterPlan(state: ArchitectGraphState): string {
  if (state.llmResponse?.done === true && state._activePhase !== 'plan') {
    console.log(`[planRouter] Plan signalled done=true → checkTaskStatus`);
    return 'checkTaskStatus';
  }

  if (state._activePhase === 'plan' && (state.llmResponse?.toolCalls?.length ?? 0) > 0) {
    // Safety Net C (plan) — no-progress circuit breaker. Streak is accrued
    // by the plan tool loop (single owner: `computeNextNoProgressStreak`)
    // from `_lastToolBatchAllDupReads`; reset at task/attempt boundaries and
    // by `finalizePlanOutcome`.
    const noProgressStreak = state._noProgressStreak || 0;
    if (noProgressStreak >= NO_PROGRESS_HARD_CAP) {
      console.warn(`⚠️  [planRouter] No-progress circuit breaker (streak=${noProgressStreak} ≥ ${NO_PROGRESS_HARD_CAP})`);
      console.warn(`   🚨 Forcing checkTaskStatus (Safety Net C / plan)`);
      return 'checkTaskStatus';
    }

    // Safety Net A (plan) — graceful recursion-budget drain for verify-mode
    // tasks (mirrors executeRouter's isFinalTask derivation).
    const currentTask = state.currentTask;
    const isFinalTask = isVerifyModeActive(state) ||
      (currentTask ? isVerificationTask(currentTask) : false);
    if (isFinalTask && state.recursionLimit && state.recursionCount) {
      const remaining = state.recursionLimit - state.recursionCount;
      if (remaining < RECURSION_DRAIN_THRESHOLD) {
        console.warn(`⚠️  [planRouter] Final task recursion budget low (${state.recursionCount}/${state.recursionLimit}) inside plan tool loop`);
        console.warn(`   🚨 Forcing checkTaskStatus → graceful drain (Safety Net A / plan)`);
        return 'checkTaskStatus';
      }
    }

    return 'tool';
  }

  return 'execute';
}
