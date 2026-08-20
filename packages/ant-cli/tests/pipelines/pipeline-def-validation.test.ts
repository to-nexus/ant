/**
 * Pipeline definition validation — table-driven policy test for the shared
 * structural rules (`validatePipelineDef`) and the server-side additions
 * (`validatePipelineDefServer`: cron min-interval, gate-anchor rule).
 * One axis, one file — add rows here, not new files.
 */

import { describe, it, expect } from 'vitest';
import { validatePipelineDef, validatePipelineActivation, PIPELINE_DEF_VERSION } from '@ant/shared';
import { validatePipelineDefServer } from '../../src/core/pipelines/store';

function baseDef(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: PIPELINE_DEF_VERSION,
    name: 'Weekly digest',
    on: { schedule: { cron: '0 9 * * 1', tz: 'Asia/Seoul' } },
    steps: [
      { id: 'collect', customJobRef: 'research/collect', directive: 'Collect sources' },
    ],
    ...overrides,
  };
}

describe('validatePipelineDef — structural rules', () => {
  const valid: Array<[string, Record<string, unknown>]> = [
    ['minimal single-step pipeline', baseDef()],
    ['intent + context + template vars', baseDef({
      steps: [{
        id: 'collect', customJobRef: 'research/collect', intent: 'gather',
        directive: 'Collect for {{trigger.fireDate}} run {{run.id}} epoch {{trigger.fireEpoch}}',
        context: ['plan/spec.md'],
      }],
    })],
    ['approval gate after a job step', baseDef({
      steps: [
        { id: 'collect', customJobRef: 'research/collect', directive: 'x' },
        { id: 'review', type: 'approval', prompt: 'Approve?', timeout: { after: '24h', onTimeout: 'reject' }, channels: ['inApp'] },
        { id: 'publish', customJobRef: 'writer/digest', directive: 'y', on: 'success' },
      ],
    })],
    ['explicit needs DAG (acyclic)', baseDef({
      steps: [
        { id: 'a', customJobRef: 'x/a', directive: 'a' },
        { id: 'b', customJobRef: 'x/b', directive: 'b', needs: ['a'] },
        { id: 'c', customJobRef: 'x/c', directive: 'c', needs: ['a'], on: 'failure' },
      ],
    })],
  ];

  it.each(valid)('accepts: %s', (_label, def) => {
    expect(validatePipelineDef(def)).toEqual([]);
  });

  const invalid: Array<[string, Record<string, unknown>, RegExp]> = [
    ['v1 version', baseDef({ version: 1 }), /version must be 2/],
    ['wrong version', baseDef({ version: 3 }), /version must be 2/],
    ['v1 enabled key (moved to activation)', baseDef({ enabled: true }), /"enabled" moved to activation/],
    ['v1 projectId key (moved to activation)', baseDef({ projectId: 'proj-x' }), /"projectId" moved to activation/],
    ['reserved step key jobType (canonical future axis)', baseDef({ steps: [{ id: 'a', customJobRef: 'x/a', directive: 'a', jobType: 'code' }] }), /"jobType" is not supported yet/],
    ['reserved step key feature (canonical future axis)', baseDef({ steps: [{ id: 'a', customJobRef: 'x/a', directive: 'a', feature: 'main' }] }), /"feature" is not supported yet/],
    ['empty name', baseDef({ name: '' }), /name/],
    ['missing schedule', baseDef({ on: {} }), /on\.schedule is required/],
    ['4-field cron', baseDef({ on: { schedule: { cron: '0 9 * *' } } }), /5 fields/],
    ['cancelPrevious overlap', baseDef({ on: { schedule: { cron: '0 9 * * 1', overlap: 'cancelPrevious' } } }), /not supported yet/],
    ['unknown top-level key', baseDef({ webhookToken: 'x' }), /unknown key "webhookToken"/],
    ['reserved step key retry', baseDef({ steps: [{ id: 'a', customJobRef: 'x/a', directive: 'a', retry: { max: 1 } }] }), /"retry" is not supported yet/],
    ['reserved step key remindAfter', baseDef({ steps: [{ id: 'a', type: 'approval', prompt: 'p', needs: [], remindAfter: '4h' }] }), /"remindAfter" is not supported yet/],
    ['steps.* template var', baseDef({ steps: [{ id: 'a', customJobRef: 'x/a', directive: '{{steps.b.summary}}' }] }), /not supported yet .*v2 axis/],
    ['unknown template var', baseDef({ steps: [{ id: 'a', customJobRef: 'x/a', directive: '{{fireDate}}' }] }), /unknown template variable/],
    ['malformed customJobRef', baseDef({ steps: [{ id: 'a', customJobRef: 'not-a-ref', directive: 'a' }] }), /customJobRef/],
    ['duplicate step ids', baseDef({ steps: [
      { id: 'a', customJobRef: 'x/a', directive: 'a' },
      { id: 'a', customJobRef: 'x/b', directive: 'b' },
    ] }), /duplicate step id/],
    ['unknown needs ref', baseDef({ steps: [{ id: 'a', customJobRef: 'x/a', directive: 'a', needs: ['ghost'] }] }), /unknown step "ghost"/],
    ['self-referencing needs', baseDef({ steps: [{ id: 'a', customJobRef: 'x/a', directive: 'a', needs: ['a'] }] }), /reference itself/],
    ['cyclic needs', baseDef({ steps: [
      { id: 'a', customJobRef: 'x/a', directive: 'a', needs: ['b'] },
      { id: 'b', customJobRef: 'x/b', directive: 'b', needs: ['a'] },
    ] }), /acyclic/],
    ['non-inApp channel', baseDef({ steps: [
      { id: 'a', customJobRef: 'x/a', directive: 'a' },
      { id: 'g', type: 'approval', prompt: 'p', channels: ['slack'] },
    ] }), /not supported yet .*"inApp"/],
    ['bad timeout duration', baseDef({ steps: [
      { id: 'a', customJobRef: 'x/a', directive: 'a' },
      { id: 'g', type: 'approval', prompt: 'p', timeout: { after: 'tomorrow', onTimeout: 'reject' } },
    ] }), /duration like/],
    ['zero steps', baseDef({ steps: [] }), /non-empty array/],
  ];

  it.each(invalid)('rejects: %s', (_label, def, pattern) => {
    const errors = validatePipelineDef(def);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('\n')).toMatch(pattern);
  });
});

describe('validatePipelineDefServer — cron interval + gate anchor', () => {
  it('rejects a sub-5-minute cron (every minute)', () => {
    const errors = validatePipelineDefServer(baseDef({ on: { schedule: { cron: '* * * * *' } } }));
    expect(errors.join('\n')).toMatch(/more often than every 5 minutes/);
  });

  it('accepts an hourly cron', () => {
    expect(validatePipelineDefServer(baseDef({ on: { schedule: { cron: '0 * * * *' } } }))).toEqual([]);
  });

  it('rejects an approval gate as the entry step', () => {
    const errors = validatePipelineDefServer(baseDef({
      steps: [
        { id: 'gate', type: 'approval', prompt: 'p' },
        { id: 'a', customJobRef: 'x/a', directive: 'a' },
      ],
    }));
    expect(errors.join('\n')).toMatch(/cannot be the entry step/);
  });

  it('rejects an approval gate with explicit empty needs', () => {
    const errors = validatePipelineDefServer(baseDef({
      steps: [
        { id: 'a', customJobRef: 'x/a', directive: 'a' },
        { id: 'gate', type: 'approval', prompt: 'p', needs: [] },
      ],
    }));
    expect(errors.join('\n')).toMatch(/cannot be the entry step/);
  });
});

describe('validatePipelineActivation — the pipeline↔project binding record', () => {
  const valid: Array<[string, Record<string, unknown>]> = [
    ['minimal binding', { projectId: 'proj-x', activatedAt: '2026-08-20T00:00:00.000Z' }],
    ['with activatedBy', { projectId: 'proj-x', activatedAt: '2026-08-20T00:00:00.000Z', activatedBy: 'user-1' }],
  ];
  it.each(valid)('accepts: %s', (_label, raw) => {
    expect(validatePipelineActivation(raw)).toEqual([]);
  });

  const invalid: Array<[string, unknown, RegExp]> = [
    ['non-object', 'proj-x', /must be an object/],
    ['missing projectId', { activatedAt: '2026-08-20T00:00:00.000Z' }, /projectId/],
    ['bad timestamp', { projectId: 'p', activatedAt: 'yesterday' }, /ISO timestamp/],
    ['unknown key', { projectId: 'p', activatedAt: '2026-08-20T00:00:00.000Z', token: 'x' }, /unknown key "token"/],
    ['featureId reserved (canonical future axis)', { projectId: 'p', activatedAt: '2026-08-20T00:00:00.000Z', featureId: 'main' }, /not supported yet/],
  ];
  it.each(invalid)('rejects: %s', (_label, raw, pattern) => {
    const errors = validatePipelineActivation(raw);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('\n')).toMatch(pattern);
  });
});
