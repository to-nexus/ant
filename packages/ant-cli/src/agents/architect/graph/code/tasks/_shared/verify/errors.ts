/**
 * Verification terminal errors — typed taxonomy for "this task cannot
 * converge". R2: model-only.
 */

import type { VerificationSnapshot } from './snapshot';

export type VerificationTerminalKind =
  | 'max_retries_exceeded'
  | 'no_progress'
  | 'unresolved_violations'
  | 'batch_cycle_limit';

export class VerificationTerminalError extends Error {
  readonly kind: VerificationTerminalKind;
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
