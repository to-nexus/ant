/**
 * Verification terminal errors — typed taxonomy for "this task cannot
 * converge".
 */

export type VerificationTerminalKind =
  | 'max_retries_exceeded'
  | 'unresolved_violations'
  | 'batch_cycle_limit'
  | 'flatplan_too_large'
  | 'orchestrator_fail_limit';

// Both code and design jobs retired the analogous Safety Net D/E.
// Runaway docGen loops are bounded by LangGraph `recursionLimit`;
// non-productive streaks are signaled to the LLM via the soft/hard
// warning messages in `design/nodes/docGen/index.ts` (advisory only).

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
