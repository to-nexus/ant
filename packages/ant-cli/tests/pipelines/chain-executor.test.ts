/**
 * ChainExecutor — pure DAG-advance tables. No I/O: these tests are the
 * contract the coordinator builds on (dispatch sets, skip cascades, abort vs
 * continue, gate suspension, terminal status derivation).
 */

import { describe, it, expect } from 'vitest';
import type { PipelineDef, RunRecord } from '@ant/shared';
import { buildInitialSteps, planAdvance, applyStepOutcome } from '../../src/core/pipelines/ChainExecutor';

function def(steps: any[], onStepFailure: 'abort' | 'continue' = 'abort'): PipelineDef {
  return {
    version: 2,
    name: 'p',
    on: { schedule: { cron: '0 9 * * 1' } },
    defaults: { onStepFailure },
    steps,
  } as PipelineDef;
}

function freshRun(d: PipelineDef): RunRecord {
  return {
    runId: 'r1',
    pipelineId: 'p1',
    projectId: 'proj',
    firedBy: 'cron',
    fireEpoch: 0,
    status: 'running',
    steps: buildInitialSteps(d),
    startedAt: '2026-08-19T00:00:00.000Z',
    defSnapshot: d,
  };
}

const job = (id: string, extra: Record<string, unknown> = {}) => ({ id, customJobRef: `x/${id}`, directive: id, ...extra });
const gate = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: 'approval', prompt: id, ...extra });

describe('planAdvance — initial dispatch', () => {
  it('dispatches only the root of a linear chain', () => {
    const d = def([job('a'), job('b'), job('c')]);
    const plan = planAdvance(d, freshRun(d));
    expect(plan.dispatches.map((x) => x.stepId)).toEqual(['a']);
    expect(plan.run.status).toBe('running');
    expect(plan.run.steps.map((s) => s.status)).toEqual(['dispatched', 'pending', 'pending']);
  });

  it('parallel roots serialize: first root only, the second dispatches on its seal', () => {
    const d = def([job('a'), job('b', { needs: [] })]);
    const plan = planAdvance(d, freshRun(d));
    // One job in flight per run — 'b' is ready but deferred, not skipped.
    expect(plan.dispatches.map((x) => x.stepId)).toEqual(['a']);
    expect(plan.run.steps.map((s) => s.status)).toEqual(['dispatched', 'pending']);
    const after = applyStepOutcome(d, plan.run, 'a', 'succeeded');
    expect(after.dispatches.map((x) => x.stepId)).toEqual(['b']);
  });

  it('diamond a→(b,c)→d runs strictly sequentially in file order', () => {
    const d = def([job('a'), job('b', { needs: ['a'] }), job('c', { needs: ['a'] }), job('dd', { needs: ['b', 'c'] })]);
    const s1 = planAdvance(d, freshRun(d));
    expect(s1.dispatches.map((x) => x.stepId)).toEqual(['a']);
    const s2 = applyStepOutcome(d, s1.run, 'a', 'succeeded');
    expect(s2.dispatches.map((x) => x.stepId)).toEqual(['b']);
    expect(s2.run.steps.find((s) => s.stepId === 'c')?.status).toBe('pending');
    const s3 = applyStepOutcome(d, s2.run, 'b', 'succeeded');
    expect(s3.dispatches.map((x) => x.stepId)).toEqual(['c']);
    const s4 = applyStepOutcome(d, s3.run, 'c', 'succeeded');
    expect(s4.dispatches.map((x) => x.stepId)).toEqual(['dd']);
  });

  it('is idempotent — re-planning an in-flight run dispatches nothing new', () => {
    const d = def([job('a'), job('b')]);
    const first = planAdvance(d, freshRun(d));
    const again = planAdvance(d, first.run);
    expect(again.dispatches).toEqual([]);
  });
});

describe('planAdvance — advance, skip cascade, gates', () => {
  it('success unblocks the next step', () => {
    const d = def([job('a'), job('b')]);
    const started = planAdvance(d, freshRun(d));
    const after = applyStepOutcome(d, started.run, 'a', 'succeeded');
    expect(after.dispatches.map((x) => x.stepId)).toEqual(['b']);
  });

  it('a gate suspends the run as awaiting_human', () => {
    const d = def([job('a'), gate('g'), job('b')]);
    const started = planAdvance(d, freshRun(d));
    const after = applyStepOutcome(d, started.run, 'a', 'succeeded');
    expect(after.dispatches.map((x) => x.stepId)).toEqual(['g']);
    expect(after.run.status).toBe('awaiting_human');
    expect(after.run.steps.find((s) => s.stepId === 'g')?.status).toBe('awaiting_gate');
  });

  it('gate approval (succeeded) releases the downstream step', () => {
    const d = def([job('a'), gate('g'), job('b')]);
    const s1 = planAdvance(d, freshRun(d));
    const s2 = applyStepOutcome(d, s1.run, 'a', 'succeeded');
    const s3 = applyStepOutcome(d, s2.run, 'g', 'succeeded');
    expect(s3.dispatches.map((x) => x.stepId)).toEqual(['b']);
  });

  it('gate rejection fails the branch and seals the run (abort)', () => {
    const d = def([job('a'), gate('g'), job('b')]);
    const s1 = planAdvance(d, freshRun(d));
    const s2 = applyStepOutcome(d, s1.run, 'a', 'succeeded');
    const s3 = applyStepOutcome(d, s2.run, 'g', 'failed');
    expect(s3.dispatches).toEqual([]);
    expect(s3.run.status).toBe('failed');
    expect(s3.run.steps.find((s) => s.stepId === 'b')?.status).toBe('cancelled');
  });

  it('on: failure branch runs exactly when its need failed', () => {
    const d = def([job('a'), job('ok', { needs: ['a'], on: 'success' }), job('alert', { needs: ['a'], on: 'failure' })], 'continue');
    const s1 = planAdvance(d, freshRun(d));
    const s2 = applyStepOutcome(d, s1.run, 'a', 'failed');
    expect(s2.dispatches.map((x) => x.stepId)).toEqual(['alert']);
    expect(s2.run.steps.find((s) => s.stepId === 'ok')?.status).toBe('skipped');
  });

  it('on: always runs regardless of the need outcome', () => {
    const d = def([job('a'), job('cleanup', { needs: ['a'], on: 'always' })], 'continue');
    const s1 = planAdvance(d, freshRun(d));
    const s2 = applyStepOutcome(d, s1.run, 'a', 'failed');
    expect(s2.dispatches.map((x) => x.stepId)).toEqual(['cleanup']);
  });

  it('an awaiting_clarify step keeps the run awaiting_human and blocks dependents', () => {
    const d = def([job('a'), job('b')]);
    const started = planAdvance(d, freshRun(d));
    const steps = started.run.steps.map((s) =>
      s.stepId === 'a' ? { ...s, status: 'awaiting_clarify' as const } : s,
    );
    const replanned = planAdvance(d, { ...started.run, steps });
    expect(replanned.dispatches).toEqual([]);
    expect(replanned.run.status).toBe('awaiting_human');
    expect(replanned.run.steps.map((s) => s.status)).toEqual(['awaiting_clarify', 'pending']);
  });

  it('a mixed gate + clarify wait still derives awaiting_human', () => {
    const d = def([job('a', { needs: [] }), gate('g', { needs: [] })]);
    const started = planAdvance(d, freshRun(d));
    const steps = started.run.steps.map((s) =>
      s.stepId === 'a' ? { ...s, status: 'awaiting_clarify' as const } : s,
    );
    const replanned = planAdvance(d, { ...started.run, steps });
    expect(replanned.run.status).toBe('awaiting_human');
  });

  it('an awaiting_clarify blocker defers a ready sibling (no back-door parallel dispatch)', () => {
    const d = def([job('a'), job('b', { needs: [] })]);
    const started = planAdvance(d, freshRun(d)); // a dispatched, b deferred
    const steps = started.run.steps.map((s) =>
      s.stepId === 'a' ? { ...s, status: 'awaiting_clarify' as const } : s,
    );
    const replanned = planAdvance(d, { ...started.run, steps });
    // The clarify answer re-dispatches 'a' directly, outside the planner —
    // 'b' starting now would collide with that resume.
    expect(replanned.dispatches).toEqual([]);
    expect(replanned.run.steps.find((s) => s.stepId === 'b')?.status).toBe('pending');
  });

  it('a gate arms eagerly while a job is in flight (gates hold no project slot)', () => {
    const d = def([job('a'), gate('g', { needs: ['a'] }), job('b', { needs: ['a'] })]);
    const s1 = planAdvance(d, freshRun(d));
    const s2 = applyStepOutcome(d, s1.run, 'a', 'succeeded');
    // File order: the gate arms AND the job dispatches in the same plan.
    expect(s2.dispatches.map((x) => `${x.kind}:${x.stepId}`)).toEqual(['gate:g', 'job:b']);
  });

  it('abort: a deferred ready sibling is cancelled when a failure lands', () => {
    const d = def([job('a'), job('b', { needs: [] })]); // abort default
    const started = planAdvance(d, freshRun(d)); // a dispatched, b deferred
    const after = applyStepOutcome(d, started.run, 'a', 'failed');
    expect(after.dispatches).toEqual([]);
    expect(after.run.steps.find((s) => s.stepId === 'b')?.status).toBe('cancelled');
    expect(after.run.status).toBe('failed');
  });

  it('continue: the deferred sibling dispatches after the failure', () => {
    const d = def([job('a'), job('b', { needs: [] })], 'continue');
    const started = planAdvance(d, freshRun(d));
    const after = applyStepOutcome(d, started.run, 'a', 'failed');
    expect(after.dispatches.map((x) => x.stepId)).toEqual(['b']);
  });

  it('verdict edges are a switch: the matching branch runs, the others skip and cascade', () => {
    const d = def([
      job('judge'),
      job('handle-ok', { needs: ['judge'], on: 'verdict:ok' }),
      job('handle-anomaly', { needs: ['judge'], on: 'verdict:anomaly' }),
      job('after-anomaly', { needs: ['handle-anomaly'] }),
    ], 'continue');
    const s1 = planAdvance(d, freshRun(d));
    const s2 = applyStepOutcome(d, s1.run, 'judge', 'succeeded', { verdict: 'anomaly' });
    expect(s2.dispatches.map((x) => x.stepId)).toEqual(['handle-anomaly']);
    expect(s2.run.steps.find((s) => s.stepId === 'handle-ok')?.status).toBe('skipped');
    const s3 = applyStepOutcome(d, s2.run, 'handle-anomaly', 'succeeded');
    expect(s3.dispatches.map((x) => x.stepId)).toEqual(['after-anomaly']);
  });

  it('a verdict edge never matches a FAILED need (no verdict survives failure)', () => {
    const d = def([job('judge'), job('handle-ok', { needs: ['judge'], on: 'verdict:ok' })], 'continue');
    const s1 = planAdvance(d, freshRun(d));
    const s2 = applyStepOutcome(d, s1.run, 'judge', 'failed');
    expect(s2.run.steps.find((s) => s.stepId === 'handle-ok')?.status).toBe('skipped');
  });

  it('a skipped need is neither success nor failure — downstream skips cascade', () => {
    const d = def([job('a'), job('b', { needs: ['a'] }), job('c', { needs: ['b'] })], 'continue');
    const s1 = planAdvance(d, freshRun(d));
    const s2 = applyStepOutcome(d, s1.run, 'a', 'failed');
    expect(s2.run.steps.find((s) => s.stepId === 'b')?.status).toBe('skipped');
    expect(s2.run.steps.find((s) => s.stepId === 'c')?.status).toBe('skipped');
    expect(s2.run.status).toBe('failed');
  });
});

describe('planAdvance — terminal status', () => {
  it('all succeeded → completed', () => {
    const d = def([job('a'), job('b')]);
    const s1 = planAdvance(d, freshRun(d));
    const s2 = applyStepOutcome(d, s1.run, 'a', 'succeeded');
    const s3 = applyStepOutcome(d, s2.run, 'b', 'succeeded');
    expect(s3.run.status).toBe('completed');
  });

  it('abort policy: any failure → failed', () => {
    const d = def([job('a'), job('b')]);
    const s1 = planAdvance(d, freshRun(d));
    const s2 = applyStepOutcome(d, s1.run, 'a', 'failed');
    expect(s2.run.status).toBe('failed');
  });

  it('continue policy: mixed outcomes → partial', () => {
    const d = def([job('a'), job('b', { needs: [] }), job('c', { needs: ['a', 'b'], on: 'always' })], 'continue');
    const s1 = planAdvance(d, freshRun(d));
    const s2 = applyStepOutcome(d, s1.run, 'a', 'failed');
    const s3 = applyStepOutcome(d, s2.run, 'b', 'succeeded');
    expect(s3.dispatches.map((x) => x.stepId)).toEqual(['c']);
    const s4 = applyStepOutcome(d, s3.run, 'c', 'succeeded');
    expect(s4.run.status).toBe('partial');
  });

  it('continue policy: everything failed → failed', () => {
    const d = def([job('a')], 'continue');
    const s1 = planAdvance(d, freshRun(d));
    const s2 = applyStepOutcome(d, s1.run, 'a', 'failed');
    expect(s2.run.status).toBe('failed');
  });
});
