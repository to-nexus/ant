/**
 * Verification terminal errors — typed taxonomy for "this verification
 * task cannot converge".
 *
 * Replaces the string-matching dance that used to live in
 * `utils/verificationErrors.ts` plus `TaskOrchestrator.isDeterministicError`:
 * a discriminated union + `instanceof` check give the orchestrator an
 * unambiguous signal with no regex surprises.
 *
 * The five kinds map 1:1 to the `VerificationOutcome` terminal branch
 * (see `outcome.ts`). Adding a new kind requires:
 *   1. Extending `VerificationTerminalKind` below.
 *   2. Producing it from `VerificationSession.evaluate(...)`.
 *   3. Covering it in `tests/tasks/verification/session.test.ts` "all kinds"
 *      fixture.
 * Orchestrator-side handling is automatic (classifyTerminalError recognises
 * every instance).
 *
 * R2 — model-only module. `VerificationSnapshot` is imported for the
 * optional `carryOver` payload; nothing from phase/routers/parallel.
 */

import type { VerificationSnapshot } from './snapshot';

export type VerificationTerminalKind =
  /** In-plan retries exhausted (`retries >= maxRetries`). */
  | 'max_retries_exceeded'
  /** Unified attempt counter reached `MAX_VERIFICATION_ATTEMPTS`. */
  | 'budget_exhausted'
  /** LLM produced the same plan hash ≥2 consecutive attempts — stuck. */
  | 'no_progress'
  /** Worker subgraph exited with unresolved violations after all retries. */
  | 'unresolved_violations'
  /** Batch split cycle limit exceeded — absorbed from former `task._failed` path. */
  | 'batch_cycle_limit';

/**
 * Typed terminal error. Orchestrator's `reportFailure` consults
 * `classifyTerminalError` BEFORE legacy regex predicates, so any caller
 * that throws this class wins unambiguously.
 */
export class VerificationTerminalError extends Error {
  readonly kind: VerificationTerminalKind;
  /** Snapshot captured at the moment of failure, for observability and resume. */
  readonly carryOver?: VerificationSnapshot | null;

  constructor(
    kind: VerificationTerminalKind,
    message: string,
    carryOver?: VerificationSnapshot | null,
  ) {
    super(message);
    this.name = 'VerificationTerminalError';
    this.kind = kind;
    this.carryOver = carryOver;
    // Preserve prototype across transpilation so `instanceof` works through
    // throw/catch boundaries (Node 16+ class-extending-Error quirk).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type TerminalClassification =
  | { terminal: true; kind: VerificationTerminalKind }
  | { terminal: false };

/**
 * Called by `TaskOrchestrator.reportFailure` BEFORE
 * `isDeterministicError`/`isRecursionLimitError` so typed errors take
 * precedence over string-matching.
 */
export function classifyTerminalError(error: Error): TerminalClassification {
  if (error instanceof VerificationTerminalError) {
    return { terminal: true, kind: error.kind };
  }
  return { terminal: false };
}
