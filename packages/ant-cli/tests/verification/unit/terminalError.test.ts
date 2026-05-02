/**
 * L1 — `classifyTerminalError` dispatcher invariants.
 *
 * Ensures typed terminal errors are recognised by the orchestrator
 * BEFORE the legacy regex-based `isDeterministicError` runs.
 */

import { describe, it, expect } from 'vitest';
import { VerificationTerminalError, classifyTerminalError } from '../../../src/agents/architect/graph/code/tasks/_shared/verify/terminal/errors';

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
      'unresolved_violations',
      'batch_cycle_limit',
      'orchestrator_fail_limit',
    ] as const;
    for (const k of kinds) {
      expect(classifyTerminalError(new VerificationTerminalError(k, 'msg'))).toEqual({ terminal: true, kind: k });
    }
  });

  it('preserves instanceof through throw/catch so callers can branch on type', () => {
    try {
      throw new VerificationTerminalError('batch_cycle_limit', 'loop detected');
    } catch (e) {
      expect(e instanceof VerificationTerminalError).toBe(true);
      expect((e as VerificationTerminalError).kind).toBe('batch_cycle_limit');
    }
  });
});
