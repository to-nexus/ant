/**
 * Verification terminal errors — typed taxonomy for "this task cannot
 * converge".
 */

export type VerificationTerminalKind =
  | 'max_retries_exceeded'
  | 'unresolved_violations'
  | 'batch_cycle_limit'
  | 'orchestrator_fail_limit'
  // Worker-scope call-budget safety net — docGen / execute call loops
  // that overrun the per-task max-call ceiling. Surfaced as terminal so
  // `TaskOrchestrator.reportFailure` stops re-queuing the task.
  // Without this, a task that exhausts the call budget is re-entered
  // from the worker subgraph's `__start__` → `plan` edge, producing the
  // `spare-keeping-metal` task_fail-then-plan-loop pattern.
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
