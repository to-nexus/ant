/**
 * Verification Attempts — single source of truth for verification re-entry accounting.
 *
 * Replaces three separate fields that previously tracked overlapping notions of
 * "how many attempts has this verification task had?":
 *
 *   - `_verificationBudget` (remaining budget, counted down) → `remainingBudget()`
 *   - `_diagnosticAttempts` (re-entry count, counted up)     → `state._verificationAttempts`
 *   - `_deepDiagnosticBudgetGranted` (one-shot flag)         → `inDeepDiagnosticMode()`
 *
 * A single monotonic counter `_verificationAttempts` is incremented on every
 * re-entry into the verification plan node (retry, reverify, fresh after
 * orchestrator re-queue). All policy decisions — budget remaining, deep-diagnostic
 * activation, termination — are derived from this one field.
 *
 * The counter carries across `worker invocation` boundaries via the snapshot
 * captured in `TaskWorker.captureState()` and attached to `task.resumeState` at
 * every exit boundary (see `TaskOrchestrator.handleInterruption` / `reportFailure`
 * and `plan.processDiagnosticBatchSplit`).
 */

import type { ArchitectGraphState } from '../state';

/**
 * Maximum total verification attempts across ALL boundaries (in-plan retry +
 * reverify + orchestrator re-queue). When exceeded, the task is marked as
 * `VerificationTerminalError(kind='budget_exhausted')` and escalates to the
 * user without further retries.
 *
 * Default 6; overridable via `ANT_MAX_VERIFICATION_ATTEMPTS`. The historical
 * `ANT_VERIFICATION_BUDGET` env variable is still honoured for backward
 * compatibility (it controls the same ceiling).
 */
export const MAX_VERIFICATION_ATTEMPTS = (() => {
  const legacy = process.env.ANT_VERIFICATION_BUDGET;
  const current = process.env.ANT_MAX_VERIFICATION_ATTEMPTS;
  const raw = current ?? legacy ?? '6';
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 6;
})();

/**
 * Threshold at which deep-diagnostic mode activates. Same semantics as the
 * historical G-7 bump (was: "grant +3 budget on 2nd re-entry"). Now expressed
 * as a simple attempt-count threshold.
 */
export const DEEP_DIAGNOSTIC_THRESHOLD = 2;

/**
 * Ensure the counter is initialised. Callers must invoke this on fresh
 * verification task entry so subsequent helpers operate on a concrete number.
 */
export function initAttempts(state: ArchitectGraphState): void {
  if (state._verificationAttempts === undefined) state._verificationAttempts = 0;
}

/**
 * Increment the attempt counter by one. Called from:
 *
 *   - `handleRetryEntry` (enforce → plan re-entry)
 *   - `handleReverifyEntry` (execute.done → plan re-entry)
 *   - Orchestrator re-queue path (new worker invocation after reportFailure
 *     transient retry), through the carried-over snapshot.
 */
export function bumpAttempts(state: ArchitectGraphState): void {
  state._verificationAttempts = (state._verificationAttempts || 0) + 1;
}

/**
 * Attempts consumed so far.
 */
export function usedAttempts(state: ArchitectGraphState): number {
  return state._verificationAttempts || 0;
}

/**
 * Remaining attempts. When zero, the next diagnostic cycle should not begin;
 * instead the task should escalate (force-split or terminal-error).
 */
export function remainingBudget(state: ArchitectGraphState): number {
  return Math.max(0, MAX_VERIFICATION_ATTEMPTS - usedAttempts(state));
}

/**
 * True once the verification task has re-entered the plan node at least
 * `DEEP_DIAGNOSTIC_THRESHOLD` times without converging. Downstream modules
 * use this to loosen command guards, inject config snapshots, and widen
 * the inspection allow-list (see `deepDiagnosticMode.ts`).
 */
export function inDeepDiagnosticMode(state: ArchitectGraphState): boolean {
  return usedAttempts(state) >= DEEP_DIAGNOSTIC_THRESHOLD;
}

// T8 — `shouldStopVerification` removed. Budget exhaustion is now a terminal
// verdict produced by `VerificationSession.evaluate()` (§10.3). Callers that
// previously inspected this predicate rely on `session.remainingBudget()`
// directly and let the hook/session path throw
// `VerificationTerminalError('budget_exhausted')` at the terminal sink.
