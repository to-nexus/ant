import { describe, it, expect } from 'vitest';

import { deriveResumableState, deriveRestoreMode } from '../../src/core/session/resumable';
import type { ResumableVerdict } from '../../src/core/session/resumable';
import type { SessionState } from '../../src/core/types/session';

const withState = (over: Partial<SessionState>): SessionState => ({ ...over });

describe('deriveResumableState — single owner of the resumable verdict', () => {
  it('synthesizes server_crash when queue remains but no interruption persisted (the 404 case)', () => {
    const v = deriveResumableState(
      withState({ jobId: 'j1', taskQueue: [{ id: 't6' }, { id: 't7' }], completedTasks: ['t1'] }),
      'code',
      { isActuallyRunning: false },
    );
    expect(v.hasResumableWork).toBe(true);
    expect(v.synthesized).toBe(true);
    expect(v.interruption?.reason).toBe('server_crash');
    expect(v.canResume).toBe(true);
  });

  it('treats orphaned runningTasks (no queue, no interruption) as resumable', () => {
    const v = deriveResumableState(
      withState({ jobId: 'j1', taskQueue: [], runningTasks: [{ id: 't6' }] }),
      'code',
    );
    expect(v.hasResumableWork).toBe(true);
    expect(v.canResume).toBe(true);
  });

  it('treats a lone currentTask as resumable work', () => {
    const v = deriveResumableState(withState({ jobId: 'j1', currentTask: { id: 't6' } }), 'code');
    expect(v.hasResumableWork).toBe(true);
    expect(v.canResume).toBe(true);
  });

  it('prefers an explicitly persisted interruption over synthesis', () => {
    const explicit = { reason: 'recursion_limit', message: 'm', timestamp: 't', canResume: true } as const;
    const v = deriveResumableState(
      withState({ jobId: 'j1', taskQueue: [{ id: 't2' }], interruption: { ...explicit } }),
      'code',
    );
    expect(v.synthesized).toBe(false);
    expect(v.interruption).toEqual(explicit);
    expect(v.canResume).toBe(true);
  });

  it('is NOT resumable for plan/visual (isMidGraphResumable=false) even with leftover work', () => {
    for (const jobType of ['plan', 'visual']) {
      const v = deriveResumableState(withState({ jobId: 'j1', taskQueue: [{ id: 't2' }] }), jobType);
      expect(v.hasResumableWork).toBe(true);
      expect(v.interruption?.canResume).toBe(false);
      expect(v.canResume).toBe(false);
    }
  });

  it('is NOT resumable while the job is actually running', () => {
    const v = deriveResumableState(
      withState({ jobId: 'j1', taskQueue: [{ id: 't2' }] }),
      'code',
      { isActuallyRunning: true },
    );
    expect(v.canResume).toBe(false);
  });

  it('stale interruption (empty queue, tasks completed) is not resumable', () => {
    // recursion-limit retry that ultimately succeeded: queue drained, no
    // currentTask/runningTasks — must subsume the old taskQueue===0 && completed>0 guard.
    const v = deriveResumableState(
      withState({
        jobId: 'j1',
        taskQueue: [],
        completedTasks: ['t1', 't2'],
        interruption: { reason: 'recursion_limit', message: 'm', timestamp: 't', canResume: true },
      }),
      'code',
    );
    expect(v.hasResumableWork).toBe(false);
    expect(v.canResume).toBe(false);
  });

  it('completed job (completedAt, no interruption, nothing left) is not resumable', () => {
    const v = deriveResumableState(
      withState({ jobId: 'j1', taskQueue: [], completedTasks: ['t1'], jobTiming: { completedAt: '2026-07-09T00:00:00Z' } as any }),
      'code',
    );
    expect(v.isJobCompleted).toBe(true);
    expect(v.canResume).toBe(false);
  });

  it('empty/undefined session yields a non-resumable verdict with null interruption', () => {
    const v = deriveResumableState(undefined, 'code');
    expect(v.hasResumableWork).toBe(false);
    expect(v.interruption).toBeNull();
    expect(v.canResume).toBe(false);
  });
});

describe('deriveRestoreMode — single owner of the runner restore decision (sharp-choking-glove)', () => {
  const resumable: ResumableVerdict = {
    hasResumableWork: true,
    isJobCompleted: false,
    interruption: { reason: 'user_stopped', message: 'm', timestamp: 't', canResume: true },
    synthesized: false,
    canResume: true,
  };
  const base = {
    verdict: resumable,
    explicitResume: false,
    hasNewDirective: false,
    dismissed: false,
  };

  it('explicit /resume wins — plain resume even when dismissed', () => {
    expect(deriveRestoreMode({ ...base, explicitResume: true })).toBe('resume');
    expect(deriveRestoreMode({ ...base, explicitResume: true, dismissed: true })).toBe('resume');
  });

  it('dismissed session never hijacks an implicit new turn', () => {
    expect(deriveRestoreMode({ ...base, dismissed: true, hasNewDirective: true })).toBe('fresh');
    expect(deriveRestoreMode({ ...base, dismissed: true })).toBe('fresh');
  });

  it('divergent explicit intent always wins over leftovers (the incident)', () => {
    expect(
      deriveRestoreMode({
        ...base,
        hasNewDirective: true,
        newIntent: 'gen-spec',
        restoredIntent: 'rev-spec',
      }),
    ).toBe('fresh');
  });

  it('same-intent feedback turn restores as revise context', () => {
    expect(
      deriveRestoreMode({
        ...base,
        hasNewDirective: true,
        newIntent: 'rev-spec',
        restoredIntent: 'rev-spec',
      }),
    ).toBe('revise-context');
  });

  it('infer feedback turn (no new intent) on a not-dismissed session restores as revise context', () => {
    expect(deriveRestoreMode({ ...base, hasNewDirective: true })).toBe('revise-context');
  });

  it('non-resumable verdict (canResume=false) → fresh for implicit turns', () => {
    const v: ResumableVerdict = { ...resumable, canResume: false };
    expect(deriveRestoreMode({ ...base, verdict: v, hasNewDirective: true })).toBe('fresh');
  });

  it('a new turn with no directive is a new job — never a silent resume', () => {
    expect(deriveRestoreMode({ ...base })).toBe('fresh');
  });

  it('no leftover work → fresh regardless of everything else', () => {
    const v: ResumableVerdict = { ...resumable, hasResumableWork: false };
    expect(deriveRestoreMode({ ...base, verdict: v, explicitResume: true })).toBe('fresh');
  });
});
