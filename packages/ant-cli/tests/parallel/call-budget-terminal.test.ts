/**
 * Call-budget terminal-classification regression.
 *
 * Context (spare-keeping-metal RCA):
 *   - design worker subgraph's Gate 1 used to throw a generic `Error`
 *     when `_callLimitReached` fired. `classifyTerminalError` only
 *     matches `VerificationTerminalError`, so generic errors fell
 *     through to `TaskOrchestrator`'s transient-retry branch. The task
 *     was re-queued, the worker subgraph restarted at its `__start__`
 *     → `plan` edge, and the job produced the `task_fail` → `plan`
 *     phase tool-call loop the user reported.
 *   - Fix: the Gate 1 throw now emits
 *     `new VerificationTerminalError('call_budget_exhausted', ...)`.
 *     This test locks the classification so the call-budget safety
 *     net always short-circuits the retry path.
 */

import { describe, it, expect } from 'vitest';
import {
  VerificationTerminalError,
  classifyTerminalError,
} from '../../src/agents/architect/graph/code/tasks/_shared/verify/terminal/errors';

describe('VerificationTerminalKind includes call_budget_exhausted', () => {
  it('constructs without a TS compile-time error and preserves the kind', () => {
    const err = new VerificationTerminalError(
      'call_budget_exhausted',
      'Task "t" exhausted call budget (25 calls) without producing valid output.',
    );
    expect(err).toBeInstanceOf(VerificationTerminalError);
    expect(err).toBeInstanceOf(Error);
    expect(err.kind).toBe('call_budget_exhausted');
    expect(err.name).toBe('VerificationTerminalError');
    expect(err.message).toMatch(/exhausted call budget/);
  });

  it('classifyTerminalError returns terminal=true with kind=call_budget_exhausted', () => {
    const err = new VerificationTerminalError(
      'call_budget_exhausted',
      'budget overrun',
    );
    const result = classifyTerminalError(err);
    expect(result.terminal).toBe(true);
    if (result.terminal) {
      expect(result.kind).toBe('call_budget_exhausted');
    }
  });

  it('a plain Error carrying the same message is NOT classified as terminal', () => {
    // Regression: the original `throw new Error(...)` path fell through
    // this branch and reached the orchestrator's transient-retry branch.
    const plain = new Error(
      'Task "t" exhausted call budget (25 calls) without producing valid output.',
    );
    const result = classifyTerminalError(plain);
    expect(result.terminal).toBe(false);
  });

  it('keeps other terminal kinds intact (no accidental overlap)', () => {
    const unresolved = new VerificationTerminalError(
      'unresolved_violations',
      'v1, v2, v3',
    );
    const classified = classifyTerminalError(unresolved);
    expect(classified.terminal).toBe(true);
    if (classified.terminal) {
      expect(classified.kind).toBe('unresolved_violations');
    }
  });
});
