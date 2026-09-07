/**
 * draft.ts pure-mutator tables — the DAG-authoring contract the canvas and
 * inspector build on: linear defs stay implicit (zero YAML churn), non-linear
 * edits materialize first, insert splices through, remove rewires dependents,
 * and the needs picker's cycle-proof exclusion set.
 */

import { describe, it, expect } from 'vitest';
import type { PipelineDef, PipelineStepDef } from '@ant/shared';
import {
  STEP_ID_PATTERN,
  TRIGGER_NODE_ID,
  descendantsOf,
  effectiveNeedsOf,
  insertStepAfter,
  materializeNeeds,
  removeStep,
  renameStep,
  setStepNeeds,
  updateSchedule,
} from '../../src/presentation/components/Pipelines/draft';
import { upstreamStepIds } from '../../src/presentation/components/Pipelines/upstreamOutputs';

const job = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, customJobRef: `x/${id}`, ...extra }) as PipelineStepDef;

function def(steps: PipelineStepDef[]): PipelineDef {
  return { version: 2, name: 'p', on: { schedule: { cron: '0 9 * * 1' } }, steps } as PipelineDef;
}

const edges = (d: PipelineDef) => d.steps.map((s, i) => [s.id, effectiveNeedsOf(d, i)] as const);

describe('materializeNeeds', () => {
  it('is semantically identity — every effective edge survives', () => {
    const d = def([job('a'), job('b'), job('c', { needs: ['a'] })]);
    const m = materializeNeeds(d);
    expect(edges(m)).toEqual(edges(d));
    expect(m.steps.every((s) => s.needs !== undefined)).toBe(true);
  });
});

describe('insertStepAfter', () => {
  it('linear def: positional splice, steps stay implicit', () => {
    const d = def([job('a'), job('b')]);
    const next = insertStepAfter(d, 'a', job('n'));
    expect(next.steps.map((s) => s.id)).toEqual(['a', 'n', 'b']);
    expect(next.steps.every((s) => s.needs === undefined)).toBe(true);
  });

  it('DAG def: splice-through — dependents of the anchor rewire onto the new step', () => {
    const d = def([job('a'), job('b', { needs: ['a'] }), job('c', { needs: ['a'] })]);
    const next = insertStepAfter(d, 'a', job('n'));
    expect(effectiveNeedsOf(next, next.steps.findIndex((s) => s.id === 'n'))).toEqual(['a']);
    for (const id of ['b', 'c']) {
      expect(effectiveNeedsOf(next, next.steps.findIndex((s) => s.id === id))).toEqual(['n']);
    }
  });

  it('DAG def: insert after the trigger rewires every other root', () => {
    const d = def([job('a'), job('b', { needs: [] })]);
    const next = insertStepAfter(d, TRIGGER_NODE_ID, job('n'));
    const idx = (id: string) => next.steps.findIndex((s) => s.id === id);
    expect(effectiveNeedsOf(next, idx('n'))).toEqual([]);
    expect(effectiveNeedsOf(next, idx('a'))).toEqual(['n']);
    expect(effectiveNeedsOf(next, idx('b'))).toEqual(['n']);
  });
});

describe('removeStep', () => {
  it('linear def: the implicit chain closes over the hole', () => {
    const d = def([job('a'), job('b'), job('c')]);
    const next = removeStep(d, 'b');
    expect(edges(next)).toEqual([
      ['a', []],
      ['c', ['a']],
    ]);
  });

  it('DAG def: dependents rewire onto the removed step\'s needs — no dangling refs', () => {
    const d = def([job('a'), job('b', { needs: ['a'] }), job('c', { needs: ['b'] }), job('e', { needs: ['b', 'a'] })]);
    const next = removeStep(d, 'b');
    const idx = (id: string) => next.steps.findIndex((s) => s.id === id);
    expect(effectiveNeedsOf(next, idx('c'))).toEqual(['a']);
    // De-duplicated: 'a' was both a direct need and inherited.
    expect(effectiveNeedsOf(next, idx('e'))).toEqual(['a']);
    for (const [, needs] of edges(next)) {
      for (const n of needs) expect(next.steps.some((s) => s.id === n)).toBe(true);
    }
  });
});

describe('setStepNeeds / descendantsOf', () => {
  it('undefined resets to the implicit previous-step edge', () => {
    const d = def([job('a'), job('b', { needs: [] })]);
    const next = setStepNeeds(d, 'b', undefined);
    expect(next.steps[1].needs).toBeUndefined();
    expect(effectiveNeedsOf(next, 1)).toEqual(['a']);
  });

  it('descendantsOf excludes every transitive dependent (cycle-proof picker)', () => {
    const d = def([job('a'), job('b', { needs: ['a'] }), job('c', { needs: ['b'] }), job('e', { needs: [] })]);
    const out = descendantsOf(d, 'a');
    expect([...out].sort()).toEqual(['b', 'c']);
    expect(out.has('e')).toBe(false);
  });
});

describe('renameStep', () => {
  it('renames the step, every needs entry, and every {{steps.<id>.*}} reference — nothing else', () => {
    const d = def([
      job('lookup'),
      job('schedule', { needs: ['lookup'], directive: '케이스: {{steps.lookup.answer}} / {{ steps.lookup.artifacts }}' }),
      { id: 'gate', type: 'approval', prompt: 'p', needs: ['schedule'] } as unknown as PipelineStepDef,
      job('lookup-ledger', { needs: ['gate'], directive: '{{steps.lookup-ledger.answer}} stays' }),
    ]);
    const r = renameStep(d, 'lookup', 'lookup-period');
    expect(r.steps.map((s) => s.id)).toEqual(['lookup-period', 'schedule', 'gate', 'lookup-ledger']);
    expect(r.steps[1].needs).toEqual(['lookup-period']);
    expect((r.steps[1] as { directive?: string }).directive).toBe('케이스: {{steps.lookup-period.answer}} / {{ steps.lookup-period.artifacts }}');
    // A different step whose id merely starts with the old id is untouched.
    expect((r.steps[3] as { directive?: string }).directive).toBe('{{steps.lookup-ledger.answer}} stays');
  });

  it('is identity for a taken, invalid, or unchanged id', () => {
    const d = def([job('a'), job('b')]);
    expect(renameStep(d, 'a', 'b')).toBe(d);
    expect(renameStep(d, 'a', 'A')).toBe(d);
    expect(renameStep(d, 'a', '-x')).toBe(d);
    expect(renameStep(d, 'a', 'a')).toBe(d);
    expect(STEP_ID_PATTERN.test('lookup-period')).toBe(true);
  });
});

describe('updateSchedule', () => {
  // A hand-authored def may carry BOTH triggers (an error-handler pipeline
  // with a schedule); editing the cron used to rebuild `on` as `{ schedule }`
  // and silently delete the runCompleted half.
  it('patches the schedule and keeps a coexisting runCompleted trigger', () => {
    const d = {
      ...def([job('a')]),
      on: { schedule: { cron: '0 9 * * 1' }, runCompleted: { pipelineId: 'up', statuses: ['failed'] } },
    } as PipelineDef;
    const r = updateSchedule(d, { cron: '0 8 * * 1', tz: 'Asia/Seoul' });
    expect(r.on).toEqual({ schedule: { cron: '0 8 * * 1', tz: 'Asia/Seoul' }, runCompleted: { pipelineId: 'up', statuses: ['failed'] } });
  });
});

describe('upstreamStepIds', () => {
  it('is the transitive needs closure, implicit edges included; jobsOnly drops gates', () => {
    const d = def([
      job('a'),
      job('b'),
      { id: 'g', type: 'approval', prompt: 'p' } as unknown as PipelineStepDef,
      job('c', { needs: ['g'] }),
      job('d', { needs: [] }),
    ]);
    expect(upstreamStepIds(d, 'c')).toEqual(['a', 'b', 'g']);
    expect(upstreamStepIds(d, 'c', { jobsOnly: true })).toEqual(['a', 'b']);
    expect(upstreamStepIds(d, 'd')).toEqual([]);
    expect(upstreamStepIds(d, 'zzz')).toEqual([]);
  });
});
