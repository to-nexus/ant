/**
 * Verification terminal errors — typed error taxonomy for "this verification
 * task cannot converge" failures.
 *
 * Before this module, the two sites that raised terminal failures
 * (`plan.handleRetryEntry` on maxRetries and `TaskWorker.executeTask` on
 * unresolved violations) emitted plain `Error(...)` instances whose
 * messages were pattern-matched by `isDeterministicError` in the
 * orchestrator. Mismatches in that regex directly caused the
 * `still-lacing-north` incident: the plan `throw` read "failed after N
 * attempts" which matched no regex, so the orchestrator classified it as
 * transient and re-queued the task, losing all progress.
 *
 * This module replaces the string-matching dance with a discriminated
 * union. `classifyTerminalError` is the single predicate the orchestrator
 * consults; the four `kind`s map to explicit re-queue/escalate decisions.
 */

import type { WorkerSnapshot } from '../../../../common/graph/parallelTypes';

export type VerificationTerminalKind =
  /** In-plan retries exhausted (`retries >= maxRetries`). */
  | 'max_retries_exceeded'
  /** Unified attempt counter reached `MAX_VERIFICATION_ATTEMPTS`. */
  | 'budget_exhausted'
  /** LLM produced the same plan structure twice in a row without progress. */
  | 'no_progress'
  /** Worker subgraph exited with unresolved violations after all retries. */
  | 'unresolved_violations'
  /**
   * Batch split cycle limit reached (`_batchSplitCount > MAX_BATCH_SPLIT_CYCLES`).
   * Absorbed from the former `task._failed = true` side-effect path in
   * `plan.processDiagnosticBatchSplit` (T8). Raised as a typed terminal error
   * so `TaskOrchestrator.reportFailure` takes the permanent-fail branch and
   * the orchestrator becomes the single sink that sets `_failed=true`.
   */
  | 'batch_cycle_limit';

/**
 * Typed terminal error. When thrown from plan/execute/TaskWorker and caught
 * by `TaskOrchestrator.reportFailure`, the classification is unambiguous —
 * no regex, no string-matching surprises.
 */
export class VerificationTerminalError extends Error {
  readonly kind: VerificationTerminalKind;
  /** Snapshot captured at the moment of failure, for observability. */
  readonly carryOver?: WorkerSnapshot | null;

  constructor(kind: VerificationTerminalKind, message: string, carryOver?: WorkerSnapshot | null) {
    super(message);
    this.name = 'VerificationTerminalError';
    this.kind = kind;
    this.carryOver = carryOver;
  }
}

export type TerminalClassification =
  /** Do not retry; surface to user via interruption. */
  | { terminal: true; kind: VerificationTerminalKind }
  /** Not a verification terminal error; orchestrator's legacy regex still decides. */
  | { terminal: false };

/**
 * Determine whether an error is a verification terminal failure. Called by
 * `TaskOrchestrator.reportFailure` BEFORE the legacy `isDeterministicError`
 * / `isRecursionLimitError` predicates so typed errors win.
 */
export function classifyTerminalError(error: Error): TerminalClassification {
  if (error instanceof VerificationTerminalError) {
    return { terminal: true, kind: error.kind };
  }
  return { terminal: false };
}
