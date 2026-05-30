/**
 * Phase 7 — typed errors for the feature deletion cascade.
 *
 * Locks the cross-boundary error shape (sibling of project deletion) +
 * the abstract base extraction so both domain classes produce identical
 * shape modulo the `kind` discriminator.
 */

import { describe, it, expect } from 'vitest';
import {
  FeatureDeletionError,
  ProjectDeletionError,
  PhasedOperationError,
} from '../../src/periphery/adapters/http/services/ProjectService/errors';

describe('FeatureDeletionError', () => {
  it('toShape() carries stage / message / canForceCleanup / retryable / kind=featureDeletion', () => {
    const cause = new Error('IDE pod did not stop in time');
    const err = new FeatureDeletionError('ideCleanup', cause, {
      canForceCleanup: true,
      hint: 'Try Force Delete',
    });

    expect(err.stage).toBe('ideCleanup');
    expect(err.kind).toBe('featureDeletion');
    expect(err.canForceCleanup).toBe(true);
    expect(err.retryable).toBe(true);
    expect(err.message).toBe('[ideCleanup] IDE pod did not stop in time');

    expect(err.toShape()).toEqual({
      kind: 'featureDeletion',
      stage: 'ideCleanup',
      message: 'IDE pod did not stop in time',
      canForceCleanup: true,
      retryable: true,
      hint: 'Try Force Delete',
    });
  });

  it('toShape() omits leftovers when empty + omits hint when absent', () => {
    const err = new FeatureDeletionError('cancelJobs', new Error('boom'), {
      canForceCleanup: false,
      leftovers: [],
    });
    expect(err.toShape()).toEqual({
      kind: 'featureDeletion',
      stage: 'cancelJobs',
      message: 'boom',
      canForceCleanup: false,
      retryable: false,
    });
  });

  it('toShape() includes leftovers when present (fsVerify case)', () => {
    const err = new FeatureDeletionError('fsVerify', new Error('still there'), {
      canForceCleanup: true,
      leftovers: ['.nfs0001', 'sessions/'],
    });
    expect(err.toShape().leftovers).toEqual(['.nfs0001', 'sessions/']);
  });

  it('survives instanceof across realm-like assignments', () => {
    const err = new FeatureDeletionError('previewCleanup', new Error('ack timeout'));
    expect(err instanceof FeatureDeletionError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });
});

describe('PhasedOperationError abstract base — project / feature parity', () => {
  it('produces identical shape across domains modulo kind discriminator', () => {
    const projectShape = new ProjectDeletionError('redisCleanup', new Error('x'), {
      canForceCleanup: true,
      hint: 'h',
    }).toShape();
    const featureShape = new FeatureDeletionError('redisCleanup', new Error('x'), {
      canForceCleanup: true,
      hint: 'h',
    }).toShape();

    expect({ ...projectShape, kind: '*' }).toEqual({ ...featureShape, kind: '*' });
    expect(projectShape.kind).toBe('projectDeletion');
    expect(featureShape.kind).toBe('featureDeletion');
  });

  it('both classes inherit from PhasedOperationError', () => {
    const project = new ProjectDeletionError('cancelJobs', new Error('p'));
    const feature = new FeatureDeletionError('cancelJobs', new Error('f'));
    expect(project instanceof PhasedOperationError).toBe(true);
    expect(feature instanceof PhasedOperationError).toBe(true);
  });
});
