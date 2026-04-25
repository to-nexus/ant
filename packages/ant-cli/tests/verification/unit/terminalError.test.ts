/**
 * L1 — `classifyTerminalError` dispatcher invariants.
 *
 * Ensures that typed terminal errors are recognised by the orchestrator
 * BEFORE the legacy regex-based `isDeterministicError` runs. A miss here
 * reproduces the exact bug that caused the `still-lacing-north` infinite
 * re-queue (a fresh string message → regex misses → classified as transient).
 */

import { describe, it, expect } from 'vitest';
import { VerificationTerminalError, classifyTerminalError } from '../../../src/agents/architect/graph/code/tasks/_shared/verify/errors';

describe('classifyTerminalError', () => {
  it('returns terminal:true with kind for VerificationTerminalError', () => {
    const err = new VerificationTerminalError(
      'max_retries_exceeded',
      'Task "X" failed after 3 attempts (max: 3).',
    );
    expect(classifyTerminalError(err)).toEqual({ terminal: true, kind: 'max_retries_exceeded' });
  });

  it('returns terminal:false for plain Error (regex fallback applies)', () => {
    expect(classifyTerminalError(new Error('some transient network issue'))).toEqual({ terminal: false });
  });

  it('works for all defined kinds', () => {
    const kinds = [
      'max_retries_exceeded',
      'no_progress',
      'unresolved_violations',
      'batch_cycle_limit',
    ] as const;
    for (const k of kinds) {
      expect(classifyTerminalError(new VerificationTerminalError(k, 'msg'))).toEqual({ terminal: true, kind: k });
    }
  });

  it('preserves carryOver snapshot on the error instance', () => {
    const snap = { planText: 'plan', retries: 2 };
    const err = new VerificationTerminalError('no_progress', 'msg', snap as any);
    expect(err.carryOver).toEqual(snap);
  });

  it('preserves instanceof through throw/catch so callers can branch on type', () => {
    try {
      throw new VerificationTerminalError('no_progress', 'loop detected');
    } catch (e) {
      expect(e instanceof VerificationTerminalError).toBe(true);
      expect((e as VerificationTerminalError).kind).toBe('no_progress');
    }
  });
});
