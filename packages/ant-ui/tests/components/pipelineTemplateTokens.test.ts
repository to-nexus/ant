/**
 * The FE token vocabulary against the shared SSOT. The point of these rows is
 * that the token surface is CLOSED: two hand-copied lists used to answer
 * "which variables may I use" and the pin's had silently lost the
 * `run.prevSuccess.*` pair the validator accepts. Set membership and the
 * trigger-shape gate are the contract; no row asserts a label, which is prose.
 */

import { describe, it, expect } from 'vitest';
import { PIPELINE_STEP_OUTPUT_FIELDS, PIPELINE_TEMPLATE_VARS, type PipelineDef } from '@ant/shared';
import {
  STATIC_TOKENS,
  STEP_OUTPUT_TOKENS,
  availableStaticTokens,
  hasTokens,
  itemTemplateVarsFor,
  itemTokens,
  segmentTemplate,
  upstreamTokens,
} from '../../src/presentation/components/Pipelines/templateTokens';

const def = (on: PipelineDef['on']): PipelineDef => ({ version: 2, name: 'p', on, steps: [] }) as PipelineDef;
const names = (d: PipelineDef) => availableStaticTokens(d).map((s) => s.name).sort();

describe('token vocabulary covers the shared SSOT exactly', () => {
  it('labels every static var and invents none', () => {
    expect(Object.keys(STATIC_TOKENS).sort()).toEqual([...PIPELINE_TEMPLATE_VARS].sort());
  });

  it('labels every step-output field and invents none', () => {
    expect(Object.keys(STEP_OUTPUT_TOKENS).sort()).toEqual([...PIPELINE_STEP_OUTPUT_FIELDS].sort());
  });

  it('keys each spec by its own name, so an insert cannot mismatch its label', () => {
    for (const [key, spec] of Object.entries(STATIC_TOKENS)) expect(spec.name).toBe(key);
    for (const [key, spec] of Object.entries(STEP_OUTPUT_TOKENS)) expect(spec.name).toBe(key);
  });
});

describe('availableStaticTokens gates on what the trigger actually provides', () => {
  it('manual-only: no fire time and no previous fire', () => {
    expect(names(def(undefined))).toEqual(['run.id']);
  });

  it('upstream edge: a fire time, but no cross-run watermark', () => {
    expect(names(def({ upstream: { pipelineId: 'up' } } as PipelineDef['on']))).toEqual([
      'run.id',
      'trigger.fireDate',
      'trigger.fireEpoch',
    ]);
  });

  it('schedule: the whole whitelist, prevSuccess pair included', () => {
    expect(names(def({ schedule: { cron: '0 9 * * 1' } } as PipelineDef['on']))).toEqual([...PIPELINE_TEMPLATE_VARS].sort());
  });

  const FETCH = { fetch: { customJobRef: 'ops/tickets', api: 'jira', request: { method: 'GET', path: '/x' }, items: '$.issues', key: '$.key', fields: { summary: '$.s' }, every: '5m' } } as PipelineDef['on'];

  it('fetch: a fire time, but no cross-run watermark (runs are per item — the validator refuses prevSuccess there)', () => {
    expect(names(def(FETCH))).toEqual(['run.id', 'trigger.fireDate', 'trigger.fireEpoch']);
  });

  it('itemTokens: key + declared fields for directives, the key alone for pins, nothing without a fetch trigger', () => {
    expect(itemTokens(def(FETCH)).map((s) => s.name)).toEqual(['trigger.item.key', 'trigger.item.summary']);
    expect(itemTokens(def(FETCH), { pins: true }).map((s) => s.name)).toEqual(['trigger.item.key']);
    expect(itemTokens(def({ schedule: { cron: '0 9 * * 1' } } as PipelineDef['on']))).toEqual([]);
    expect(itemTokens(def(undefined))).toEqual([]);
  });

  it('itemTokens for a discovers def: the vocabulary reaches the per-case steps only — the discovering step, its prefix and the def-wide question get none', () => {
    const fan = {
      version: 2,
      name: 'p',
      on: { schedule: { cron: '0 9 * * 1' } },
      steps: [
        { id: 'prepare', customJobRef: 'x/a' },
        { id: 'scan', customJobRef: 'x/a', discovers: { fields: ['amount'] } },
        { id: 'handle', customJobRef: 'x/a' },
        { id: 'gate', type: 'approval', prompt: '?' },
        { id: 'record', customJobRef: 'x/a' },
      ],
    } as unknown as PipelineDef;
    const vars = ['trigger.item.key', 'trigger.item.amount'];
    expect(itemTokens(fan, { stepId: 'handle' }).map((s) => s.name)).toEqual(vars);
    expect(itemTokens(fan, { stepId: 'record' }).map((s) => s.name)).toEqual(vars);
    expect(itemTokens(fan, { stepId: 'handle', pins: true }).map((s) => s.name)).toEqual(['trigger.item.key']);
    for (const id of ['prepare', 'scan']) expect(itemTokens(fan, { stepId: id })).toEqual([]);
    expect(itemTokens(fan)).toEqual([]);
    // The same gate feeds the preview's segmenter — one derivation for both surfaces.
    expect(itemTemplateVarsFor(fan, 'handle')).toEqual(vars);
    expect(itemTemplateVarsFor(fan, 'scan')).toEqual([]);
    // A fetch vocabulary is def-wide and indifferent to the step asked about.
    expect(itemTemplateVarsFor(def(FETCH), 'anything')).toEqual(['trigger.item.key', 'trigger.item.summary']);
  });

  it('upstreamTokens: run-level fields for a run-node edge, the step-bound ones only when a step is named, nothing without the trigger', () => {
    expect(upstreamTokens(def({ upstream: { pipelineId: 'up' } } as PipelineDef['on'])).map((s) => s.name)).toEqual([
      'trigger.upstream.pipelineId',
      'trigger.upstream.runId',
      'trigger.upstream.outcome',
    ]);
    expect(upstreamTokens(def({ upstream: { pipelineId: 'up', step: 'verify' } } as PipelineDef['on'])).map((s) => s.name)).toEqual([
      'trigger.upstream.pipelineId',
      'trigger.upstream.runId',
      'trigger.upstream.outcome',
      'trigger.upstream.step',
      'trigger.upstream.verdict',
      'trigger.upstream.answer',
    ]);
    expect(upstreamTokens(def({ schedule: { cron: '0 9 * * 1' } } as PipelineDef['on']))).toEqual([]);
  });

  it('segmentTemplate labels a declared upstream var as `upstream` and an undeclared one as `unknown`', () => {
    const segs = segmentTemplate('{{trigger.upstream.runId}} {{trigger.upstream.verdict}}', [], ['trigger.upstream.runId']);
    expect(segs.filter((s) => s.kind !== 'text').map((s) => s.kind)).toEqual(['upstream', 'unknown']);
    expect(segmentTemplate('{{trigger.upstream.runId}}').map((s) => s.kind)).toEqual(['unknown']);
  });

  it('segmentTemplate labels a declared item var as `item` and an undeclared one as `unknown` — exactly as the validator judges', () => {
    const segs = segmentTemplate('{{trigger.item.key}} {{trigger.item.summary}} {{trigger.item.ghost}}', ['trigger.item.key', 'trigger.item.summary']);
    expect(segs.filter((s) => s.kind !== 'text').map((s) => s.kind)).toEqual(['item', 'item', 'unknown']);
    // Without the vocabulary (no fetch trigger) every item name is unknown.
    expect(segmentTemplate('{{trigger.item.key}}').map((s) => s.kind)).toEqual(['unknown']);
  });

  it('offers the same set the pin validator accepts — one gate, two surfaces', () => {
    // pinTemplateErrors whitelists PIPELINE_TEMPLATE_VARS wholesale, so a
    // scheduled pipeline's pin offer must not be a subset of it.
    const scheduled = names(def({ schedule: { cron: '0 9 * * 1' } } as PipelineDef['on']));
    for (const v of PIPELINE_TEMPLATE_VARS) expect(scheduled).toContain(v);
  });
});

describe('segmentTemplate', () => {
  const kinds = (t: string) => segmentTemplate(t).map((s) => s.kind);

  it.each([
    ['plain prose with no braces', ['text']],
    ['{{run.id}}', ['static']],
    ['at {{trigger.fireDate}} do it', ['text', 'static', 'text']],
    ['{{steps.intake.answer}}', ['stepOutput']],
    ['{{steps.intake.artifacts}}', ['stepOutput']],
    ['{{ run.id }}', ['static']],
    ['{{run.id}}{{trigger.fireEpoch}}', ['static', 'static']],
    ['{{nope}}', ['unknown']],
    ['{{steps.a.summary}}', ['unknown']],
    ['{{steps.a.verdict}}', ['unknown']],
    ['{{steps.a}}', ['unknown']],
  ])('%s → %j', (text, expected) => {
    expect(kinds(text)).toEqual(expected);
  });

  it('is lossless — a renderer over it can never drop a token', () => {
    for (const text of [
      'plain',
      '{{run.id}}',
      'a {{run.id}} b {{steps.x.answer}} c',
      '{{nope}} tail',
      '{{ trigger.fireDate }}{{steps.a.verdict}}',
      '',
    ]) {
      const rebuilt = segmentTemplate(text)
        .map((s) => (s.kind === 'text' ? s.text : s.raw))
        .join('');
      expect(rebuilt).toBe(text);
    }
  });

  it('resolves a step reference to its id and field', () => {
    const [seg] = segmentTemplate('{{steps.lookup-period.artifacts}}');
    expect(seg).toMatchObject({ kind: 'stepOutput', stepId: 'lookup-period' });
    expect(seg.kind === 'stepOutput' && seg.spec.name).toBe('artifacts');
  });

  it('hasTokens decides whether a preview would say anything new', () => {
    expect(hasTokens(segmentTemplate('no braces here'))).toBe(false);
    expect(hasTokens(segmentTemplate('has {{run.id}}'))).toBe(true);
    expect(hasTokens(segmentTemplate('even a broken {{nope}}'))).toBe(true);
  });
});
