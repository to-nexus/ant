/**
 * Phase 6 — typed errors for the project deletion cascade.
 *
 * Locks the cross-boundary error shape so the FE can reliably parse
 * stage / hint / leftovers / canForceCleanup off `ApiError.body`.
 */

import { describe, it, expect } from 'vitest';
import {
  ProjectDeletionError,
  DeletionVerificationError,
} from '../../src/periphery/adapters/http/services/ProjectService/errors';

describe('ProjectDeletionError', () => {
  it('toShape() carries stage / message / canForceCleanup / retryable', () => {
    const cause = new Error('K8s pod did not delete in time');
    const err = new ProjectDeletionError('ideCleanup', cause, {
      canForceCleanup: true,
      hint: 'Try Force Delete',
    });

    expect(err.stage).toBe('ideCleanup');
    expect(err.canForceCleanup).toBe(true);
    expect(err.retryable).toBe(true); // retryable defaults to canForceCleanup
    expect(err.message).toBe('[ideCleanup] K8s pod did not delete in time');

    const shape = err.toShape();
    expect(shape).toEqual({
      kind: 'projectDeletion',
      stage: 'ideCleanup',
      message: 'K8s pod did not delete in time',
      canForceCleanup: true,
      retryable: true,
      hint: 'Try Force Delete',
    });
  });

  it('toShape() omits leftovers when empty + omits hint when absent', () => {
    const err = new ProjectDeletionError('cancelJobs', new Error('boom'), {
      canForceCleanup: false,
      leftovers: [],
    });
    const shape = err.toShape();
    expect(shape).toEqual({
      kind: 'projectDeletion',
      stage: 'cancelJobs',
      message: 'boom',
      canForceCleanup: false,
      retryable: false,
    });
    expect(shape.hint).toBeUndefined();
    expect(shape.leftovers).toBeUndefined();
  });

  it('toShape() includes leftovers when present', () => {
    const err = new ProjectDeletionError('fsVerify', new Error('still there'), {
      canForceCleanup: true,
      leftovers: ['.nfs0001', 'config.json'],
    });
    expect(err.toShape().leftovers).toEqual(['.nfs0001', 'config.json']);
  });

  it('survives instanceof across realm-like assignments (Object.setPrototypeOf fix)', () => {
    const err = new ProjectDeletionError('previewCleanup', new Error('ack timeout'));
    expect(err instanceof ProjectDeletionError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });
});

describe('DeletionVerificationError', () => {
  it('carries projectPath + leftovers as typed fields, no string parsing', () => {
    const err = new DeletionVerificationError('/tmp/proj1', ['.nfs1234']);
    expect(err.projectPath).toBe('/tmp/proj1');
    expect(err.leftovers).toEqual(['.nfs1234']);
    // Message is still human-readable for log lines, but the FE must read
    // `.leftovers` (not parse the message).
    expect(err.message).toMatch(/verification timed out/);
  });

  it('pluralizes "entries" correctly in message', () => {
    expect(new DeletionVerificationError('/p', ['a']).message).toMatch(/1 leftover entry/);
    expect(new DeletionVerificationError('/p', ['a', 'b']).message).toMatch(/2 leftover entries/);
  });
});
