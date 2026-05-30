/**
 * Phase 7 — `featureDeletionSlice` state transitions.
 *
 * Mirrors `projectDeletionSlice` over the feature scope. Locks:
 *   - idle → deleting (startFeatureDeletion stores both projectId + featureName)
 *   - deleting → deleting (updateFeatureDeletionPhase advances phase + history)
 *   - deleting → completed (markFeatureDeletionComplete)
 *   - deleting → failed (markFeatureDeletionFailed maps error shape)
 *   - any → idle (resetFeatureDeletionSession)
 *   - selectFeatureDeletionFailedPhase returns the failed phase mid-cascade
 *     (force mode) and from a final failed session.
 */

import { describe, it, expect } from 'vitest';
import { create } from 'zustand';
import {
  createFeatureDeletionSlice,
  selectFeatureDeletionFailedPhase,
  type FeatureDeletionSlice,
} from '../../src/domain/store/slices/featureDeletionSlice';

function makeStore() {
  return create<FeatureDeletionSlice>()((set, get, store) =>
    createFeatureDeletionSlice(set, get, store),
  );
}

describe('featureDeletionSlice — transitions', () => {
  it('starts in idle', () => {
    const useStore = makeStore();
    expect(useStore.getState().featureDeletionSession).toEqual({ kind: 'idle' });
  });

  it('idle → deleting with projectId + featureName + empty history', () => {
    const useStore = makeStore();
    useStore.getState().startFeatureDeletion('p1', 'f1');
    const sess = useStore.getState().featureDeletionSession;
    expect(sess.kind).toBe('deleting');
    if (sess.kind !== 'deleting') return;
    expect(sess.projectId).toBe('p1');
    expect(sess.featureName).toBe('f1');
    expect(sess.phase).toBeNull();
    expect(sess.phaseHistory).toEqual([]);
  });

  it('updateFeatureDeletionPhase advances phase + records history on complete/failed', () => {
    const useStore = makeStore();
    useStore.getState().startFeatureDeletion('p1', 'f1');
    useStore.getState().updateFeatureDeletionPhase('cancelJobs', 'active');
    useStore.getState().updateFeatureDeletionPhase('cancelJobs', 'complete');
    useStore.getState().updateFeatureDeletionPhase('ideCleanup', 'active');

    const sess = useStore.getState().featureDeletionSession;
    if (sess.kind !== 'deleting') throw new Error('unexpected kind');
    expect(sess.phase).toBe('ideCleanup');
    expect(sess.phaseHistory).toEqual([{ phase: 'cancelJobs', status: 'complete' }]);
  });

  it('drops stale updates after completion (kind !== deleting)', () => {
    const useStore = makeStore();
    useStore.getState().startFeatureDeletion('p1', 'f1');
    useStore.getState().markFeatureDeletionComplete();

    useStore.getState().updateFeatureDeletionPhase('fsVerify', 'active');
    expect(useStore.getState().featureDeletionSession.kind).toBe('completed');
  });

  it('markFeatureDeletionComplete carries projectId + featureName', () => {
    const useStore = makeStore();
    useStore.getState().startFeatureDeletion('p1', 'f1');
    useStore.getState().markFeatureDeletionComplete();

    const sess = useStore.getState().featureDeletionSession;
    expect(sess.kind).toBe('completed');
    if (sess.kind !== 'completed') return;
    expect(sess.projectId).toBe('p1');
    expect(sess.featureName).toBe('f1');
  });

  it('markFeatureDeletionFailed maps error shape + correlationId', () => {
    const useStore = makeStore();
    useStore.getState().startFeatureDeletion('p1', 'f1');
    useStore.getState().markFeatureDeletionFailed(
      {
        kind: 'featureDeletion',
        stage: 'ideCleanup',
        message: 'pod stuck',
        canForceCleanup: true,
        retryable: true,
        hint: 'Try Force Delete',
      },
      'cid-abc',
    );

    const sess = useStore.getState().featureDeletionSession;
    expect(sess.kind).toBe('failed');
    if (sess.kind !== 'failed') return;
    expect(sess.stage).toBe('ideCleanup');
    expect(sess.message).toBe('pod stuck');
    expect(sess.canForceCleanup).toBe(true);
    expect(sess.hint).toBe('Try Force Delete');
    expect(sess.correlationId).toBe('cid-abc');
    expect(sess.projectId).toBe('p1');
    expect(sess.featureName).toBe('f1');
  });

  it('resetFeatureDeletionSession returns to idle from any kind', () => {
    const useStore = makeStore();
    useStore.getState().startFeatureDeletion('p1', 'f1');
    useStore.getState().resetFeatureDeletionSession();
    expect(useStore.getState().featureDeletionSession).toEqual({ kind: 'idle' });
  });
});

describe('selectFeatureDeletionFailedPhase', () => {
  it('finds failed phase from a deleting session mid-cascade (force mode continued)', () => {
    const useStore = makeStore();
    useStore.getState().startFeatureDeletion('p', 'f');
    useStore.getState().updateFeatureDeletionPhase('cancelJobs', 'complete');
    useStore.getState().updateFeatureDeletionPhase('ideCleanup', 'failed');
    useStore.getState().updateFeatureDeletionPhase('previewCleanup', 'active');

    expect(selectFeatureDeletionFailedPhase(useStore.getState())).toBe('ideCleanup');
  });

  it('returns stage from a final failed session', () => {
    const useStore = makeStore();
    useStore.getState().startFeatureDeletion('p', 'f');
    useStore.getState().markFeatureDeletionFailed(
      {
        kind: 'featureDeletion',
        stage: 'fsVerify',
        message: 'still there',
        canForceCleanup: true,
        retryable: true,
      },
      'cid',
    );
    expect(selectFeatureDeletionFailedPhase(useStore.getState())).toBe('fsVerify');
  });

  it('returns null for idle / completed / clean deleting sessions', () => {
    const useStore = makeStore();
    expect(selectFeatureDeletionFailedPhase(useStore.getState())).toBeNull();

    useStore.getState().startFeatureDeletion('p', 'f');
    expect(selectFeatureDeletionFailedPhase(useStore.getState())).toBeNull();

    useStore.getState().markFeatureDeletionComplete();
    expect(selectFeatureDeletionFailedPhase(useStore.getState())).toBeNull();
  });
});
