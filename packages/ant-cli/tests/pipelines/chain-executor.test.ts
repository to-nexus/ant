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

  it('dispatches parallel roots (explicit empty needs)', () => {
    const d = def([job('a'), job('b', { needs: [] })]);
    const plan = planAdvance(d, freshRun(d));
    expect(plan.dispatches.map((x) => x.stepId).sort()).toEqual(['a', 'b']);
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
