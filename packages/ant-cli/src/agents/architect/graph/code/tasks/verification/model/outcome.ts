/**
 * VerificationOutcome — the single typed verdict produced by
 * `VerificationSession.evaluate(...)`.
 *
 * Upstream (phase layer) calls `evaluate()` with whatever information it has
 * gathered (plan text, parsed error counts, modify count, batch count) and
 * switches on `outcome.kind`:
 *
 *   - `continue`     → proceed with the normal execute path
 *   - `short_circuit`→ set llmResponse.done=true and route to checkTaskStatus
 *   - `force_split`  → call the plan hook's `maybeSplit` synthesis path
 *   - `terminal`     → throw `VerificationTerminalError(errorKind, ...)`
 *
 * Keeping the verdict typed (instead of multiple booleans) means the phase
 * node's switch statement is exhaustive and the compiler catches missing
 * arms when a new outcome kind lands.
 *
 * R2 — model-only module.
 */

import type { VerificationTerminalKind } from './errors';

export type ShortCircuitReason =
  /** Plan produced no actionable implementation entries. */
  | 'empty_plan'
  /** All required gates already passed; no new work to drive. */
  | 'already_complete';

export type ForceSplitReason =
  /** Remaining attempt budget is too low to allow another consolidated pass. */
  | 'budget_low'
  /** Same plan structure surfaced again (count=1) — escalate to per-file split. */
  | 'repeated_plan'
  /** Diagnostic error volume crosses the escalation threshold. */
  | 'too_many_errors'
  /** Modify file fan-out crosses the escalation threshold. */
  | 'too_many_files';

export type VerificationOutcome =
  | { kind: 'continue' }
  | { kind: 'short_circuit'; reason: ShortCircuitReason }
  | { kind: 'force_split'; reason: ForceSplitReason }
  | { kind: 'terminal'; errorKind: VerificationTerminalKind; message: string };
