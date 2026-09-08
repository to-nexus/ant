/**
 * How a step names itself. The axis: a pipeline is usually several INTENTS of
 * one agent × job, so the intent is the discriminator and takes the primary
 * line; a step that pins none has no discriminator and promotes the job name
 * rather than rendering blank. Rows assert which FIELD wins, never its copy.
 */

import { describe, it, expect } from 'vitest';
import { GENERAL_INTENT, type PipelineStepDef } from '@ant/shared';
import { resolveStepIdentity, type IdentityAgentSummary } from '../../src/presentation/components/Pipelines/stepIdentity';

// The i18n stub returns the fallback, so a row can only depend on structure.
const t = (_key: string, fallback: string) => fallback;

const agents: IdentityAgentSummary[] = [
  { id: 'terms', name: 'Terms Notice', jobs: [{ id: 'notice', name: 'Notice Job' }] },
];

const job = (extra: Partial<PipelineStepDef> = {}) => ({ id: 's1', customJobRef: 'terms/notice', ...extra }) as PipelineStepDef;

describe('resolveStepIdentity', () => {
  it('a pinned intent IS the primary line', () => {
    const id = resolveStepIdentity(job({ intent: 'lookup-period' } as Partial<PipelineStepDef>), agents, t);
    expect(id.primary).toBe('lookup-period');
    expect(id.primaryIsIntent).toBe(true);
    expect(id.caption).toContain('Terms Notice');
    expect(id.caption).toContain('Notice Job');
  });

  it('no intent promotes the job name and flags that it is not an intent', () => {
    const id = resolveStepIdentity(job(), agents, t);
    expect(id.primary).toBe('Notice Job');
    expect(id.primaryIsIntent).toBe(false);
  });

  it('the reserved `general` intent is not a discriminator', () => {
    const id = resolveStepIdentity(job({ intent: GENERAL_INTENT } as Partial<PipelineStepDef>), agents, t);
    expect(id.primary).toBe('Notice Job');
    expect(id.primaryIsIntent).toBe(false);
  });

  it('sibling steps of one agent × job differ only in the primary line', () => {
    const a = resolveStepIdentity(job({ id: 'a', intent: 'lookup-period' } as Partial<PipelineStepDef>), agents, t);
    const b = resolveStepIdentity(job({ id: 'b', intent: 'schedule' } as Partial<PipelineStepDef>), agents, t);
    expect(a.primary).not.toBe(b.primary);
    expect(a.caption).toBe(b.caption);
  });

  it('an unknown agent or job degrades to the raw ids, never to blank', () => {
    const id = resolveStepIdentity(job({ customJobRef: 'ghost/missing' } as Partial<PipelineStepDef>), agents, t);
    expect(id.primary).toBe('missing');
    expect(id.caption).toContain('ghost');
  });

  it('resolves against an absent catalog (account agents not loaded yet)', () => {
    const id = resolveStepIdentity(job({ intent: 'schedule' } as Partial<PipelineStepDef>), undefined, t);
    expect(id.primary).toBe('schedule');
    expect(id.caption).toContain('terms');
  });

  it('an unconfigured step has a placeholder primary and no caption', () => {
    const id = resolveStepIdentity(job({ customJobRef: '' } as Partial<PipelineStepDef>), agents, t);
    expect(id.primary).toBeTruthy();
    expect(id.caption).toBeUndefined();
    expect(id.primaryIsIntent).toBe(false);
  });

  it('carries the raw ref in the caption title, so the card never hides it', () => {
    const id = resolveStepIdentity(job({ intent: 'schedule' } as Partial<PipelineStepDef>), agents, t);
    expect(id.captionTitle).toContain('terms/notice');
  });

  it('an approval gate names itself by kind, with its timeout as the caption', () => {
    const gate = { id: 'g', type: 'approval', prompt: 'ok?', timeout: { after: '24h', onTimeout: 'reject' } } as PipelineStepDef;
    const id = resolveStepIdentity(gate, agents, t);
    expect(id.primaryIsIntent).toBe(false);
    expect(id.caption).toContain('24h');
    const noTimeout = resolveStepIdentity({ id: 'g', type: 'approval', prompt: 'ok?' } as PipelineStepDef, agents, t);
    expect(noTimeout.caption).toBeTruthy();
  });
});
