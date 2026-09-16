/**
 * The ONE canvas with N live runs — pure derivations behind the node chips,
 * the trigger count and the selected path (`runOverlay.ts`), plus the run
 * identity vocabulary every surface shares (`runIdentity.ts`).
 */
import { describe, it, expect } from 'vitest';
import type { PipelineDef, PipelineFiredBy, PipelineLiveRun } from '@ant/shared';
import { focusRunId, selectedPath, stepRunChips, triggerBadge } from '../../src/presentation/components/Pipelines/canvas/runOverlay';
import { FIRED_BY_ICON, FIRED_BY_LABEL, runHue, runLabel, sortAssignedFirst } from '../../src/presentation/components/Pipelines/runIdentity';

const DEF = {
  version: 2,
  name: 'refund',
  steps: [
    { id: 'calc', customJobRef: 'ops/refund', directive: 'calc' },
    { id: 'gate', type: 'approval', prompt: 'ok?' },
    { id: 'pay', customJobRef: 'ops/refund', directive: 'pay' },
  ],
} as unknown as PipelineDef;

const live = (runId: string, currentStepIds: string[], status: PipelineLiveRun['status'] = 'running', startedAt = 'now'): PipelineLiveRun => ({
  runId,
  status,
  startedAt,
  firedBy: 'manual',
  currentStepIds,
});

describe('stepRunChips — each live run is a chip on the steps it is AT', () => {
  it('places one chip per (run, current step) and none elsewhere', () => {
    const chips = stepRunChips(DEF, [live('r1', ['calc']), live('r2', ['gate'], 'awaiting_human')], () => undefined);
    expect(Object.keys(chips).sort()).toEqual(['calc', 'gate']);
    expect(chips.calc.map((c) => c.runId)).toEqual(['r1']);
    expect(chips.gate.map((c) => c.runId)).toEqual(['r2']);
    expect(chips.pay).toBeUndefined();
  });

  it('two runs at the same step stack on that node', () => {
    const chips = stepRunChips(DEF, [live('r1', ['calc']), live('r2', ['calc'])], () => undefined);
    expect(chips.calc.map((c) => c.runId)).toEqual(['r1', 'r2']);
  });

  it("the chip status is the run's own step record when its detail is held", () => {
    const chips = stepRunChips(DEF, [live('r1', ['calc'])], (id) => (id === 'r1' ? { steps: [{ stepId: 'calc', status: 'dispatched' }] as any } : undefined));
    expect(chips.calc[0].status).toBe('dispatched');
  });

  it('without detail the run-level state is the word: awaiting on a gate = awaiting_gate, on a job step = awaiting_clarify, else running', () => {
    const chips = stepRunChips(DEF, [live('r1', ['gate'], 'awaiting_human'), live('r2', ['calc'], 'awaiting_human'), live('r3', ['pay'])], () => undefined);
    expect(chips.gate[0].status).toBe('awaiting_gate');
    expect(chips.calc[0].status).toBe('awaiting_clarify');
    expect(chips.pay[0].status).toBe('running');
  });

  it('a chip carries the shared label and a stable hue', () => {
    const [chip] = stepRunChips(DEF, [{ ...live('r1', ['calc']), itemKey: 'REF-42' }], () => undefined).calc;
    expect(chip.label).toBe('REF-42');
    expect(chip.hue).toBe(runHue('r1'));
  });
});

describe('triggerBadge — the trigger says only how many runs are live', () => {
  it('counts', () => {
    expect(triggerBadge([])).toEqual({ count: 0 });
    expect(triggerBadge([live('a', []), live('b', [])])).toEqual({ count: 2 });
  });
});

describe('selectedPath — the edges the focused run has traversed', () => {
  it('includes an edge once its target left pending; empty for no run', () => {
    expect(selectedPath(DEF, null).size).toBe(0);
    const path = selectedPath(DEF, { steps: [{ stepId: 'calc', status: 'succeeded' }, { stepId: 'gate', status: 'awaiting_gate' }, { stepId: 'pay', status: 'pending' }] as any });
    expect([...path].sort()).toEqual(['calc->gate', 'trigger->calc']);
  });
});

describe('focusRunId — selected if live, else the newest live run', () => {
  const runs = [live('new', [], 'running', '2026-09-16T00:00:02.000Z'), live('old', [], 'running', '2026-09-16T00:00:01.000Z')];
  it('honours a live selection', () => expect(focusRunId(runs, 'old')).toBe('old'));
  it('ignores a selection that is not live (a history row) and falls back to the newest', () => expect(focusRunId(runs, 'sealed')).toBe('new'));
  it('is undefined with no live runs', () => expect(focusRunId([], 'x')).toBeUndefined());
});

describe('runIdentity — one vocabulary for every surface', () => {
  it('runLabel prefers the case key, falls back to the run id', () => {
    expect(runLabel({ runId: 'r1', itemKey: 'REF-1' })).toBe('REF-1');
    expect(runLabel({ runId: 'r1' })).toBe('r1');
  });

  it('runHue is stable per id and spreads distinct ids', () => {
    expect(runHue('sandy-mending-cabin')).toBe(runHue('sandy-mending-cabin'));
    const hues = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map(runHue));
    expect(hues.size).toBeGreaterThan(1);
  });

  it('FIRED_BY tables are exhaustive over the trigger kinds', () => {
    const kinds: PipelineFiredBy[] = ['cron', 'manual', 'event', 'fetch'];
    for (const k of kinds) {
      expect(FIRED_BY_ICON[k]).toBeDefined();
      expect(FIRED_BY_LABEL[k].key).toMatch(/^runs\./);
    }
  });
});

describe('gate assignee on the surfaces (doc 46 §5a-ii) — routing hint, never authority', () => {
  it('a chip at a gate carries the held detail\'s assignees; a step without them carries none', () => {
    const detail = { steps: [{ stepId: 'gate', status: 'awaiting_gate', gate: { gateId: 'g', cardId: 'c', prompt: '?', armedAt: 'now', assignees: ['bob@x.io'] } }] } as any;
    const chips = stepRunChips(DEF, [live('r1', ['gate'], 'awaiting_human'), live('r2', ['calc'])], (id) => (id === 'r1' ? detail : undefined));
    expect(chips.gate[0]).toMatchObject({ runId: 'r1', assignees: ['bob@x.io'] });
    expect(chips.calc[0]).not.toHaveProperty('assignees');
  });

  it('sortAssignedFirst lifts the viewer\'s rows and keeps every other order; unknown viewer = untouched', () => {
    const rows = [{ gateId: 'a' }, { gateId: 'b', assignees: ['me@x.io'] }, { gateId: 'c', assignees: ['peer@x.io'] }, { gateId: 'd', assignees: ['me@x.io'] }];
    expect(sortAssignedFirst(rows, 'me@x.io').map((r) => r.gateId)).toEqual(['b', 'd', 'a', 'c']);
    expect(sortAssignedFirst(rows, null).map((r) => r.gateId)).toEqual(['a', 'b', 'c', 'd']);
  });
});
