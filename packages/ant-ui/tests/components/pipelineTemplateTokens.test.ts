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
  segmentTemplate,
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

  it('chain (runCompleted): a fire time, but no cross-run watermark', () => {
    expect(names(def({ runCompleted: { pipelineId: 'up' } } as PipelineDef['on']))).toEqual([
      'run.id',
      'trigger.fireDate',
      'trigger.fireEpoch',
    ]);
  });

  it('schedule: the whole whitelist, prevSuccess pair included', () => {
    expect(names(def({ schedule: { cron: '0 9 * * 1' } } as PipelineDef['on']))).toEqual([...PIPELINE_TEMPLATE_VARS].sort());
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
