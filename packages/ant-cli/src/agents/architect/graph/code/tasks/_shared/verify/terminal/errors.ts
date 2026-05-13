/**
 * Verification terminal errors — typed taxonomy for "this task cannot
 * converge".
 */

export type VerificationTerminalKind =
  | 'max_retries_exceeded'
  | 'unresolved_violations'
  | 'batch_cycle_limit'
  | 'orchestrator_fail_limit'
  // Design job docGen call-budget safety net — `_docGenCallIndex` overrun
  // surfaces as terminal so `TaskOrchestrator.reportFailure` stops re-
  // queuing the task. Code job retired the analogous Safety Net D/E and
  // no longer raises this kind.
  | 'call_budget_exhausted';

export class VerificationTerminalError extends Error {
  readonly kind: VerificationTerminalKind;

  constructor(
    kind: VerificationTerminalKind,
    message: string,
  ) {
    super(message);
    this.name = 'VerificationTerminalError';
    this.kind = kind;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type TerminalClassification =
  | { terminal: true; kind: VerificationTerminalKind }
  | { terminal: false };

/** Consulted by `TaskOrchestrator.reportFailure` before regex fallbacks. */
export function classifyTerminalError(error: Error): TerminalClassification {
  if (error instanceof VerificationTerminalError) {
    return { terminal: true, kind: error.kind };
  }
  return { terminal: false };
}
