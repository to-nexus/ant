/**
 * Pipeline definition validation — table-driven policy test for the shared
 * structural rules (`validatePipelineDef`) and the server-side additions
 * (`validatePipelineDefServer`: cron min-interval, gate-anchor rule).
 * One axis, one file — add rows here, not new files.
 */

import { describe, it, expect } from 'vitest';
import { validatePipelineDef, validatePipelineActivation, defaultStepDirective, PIPELINE_DEF_VERSION, DIRECTIVE_MAX_CHARS } from '@ant/shared';
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

describe('validatePipelineDef — directive/prompt ceiling (M-NEW-029)', () => {
  // A stored directive is dispatched on EVERY firing and becomes a durable
  // user turn plus the universal job's overrideDirective. It carries the same
  // ceiling as the direct HTTP job-start ingresses; the definition validator is
  // where the author actually sees why.
  const over = 'x'.repeat(DIRECTIVE_MAX_CHARS + 1);
  const at = 'y'.repeat(DIRECTIVE_MAX_CHARS);

  it('refuses a step directive over the ceiling', () => {
    const errors = validatePipelineDef(baseDef({
      steps: [{ id: 'collect', customJobRef: 'research/collect', directive: over }],
    }));
    expect(errors.join('\n')).toMatch(/directive must be at most/);
  });

  it('accepts a step directive exactly at the ceiling (inclusive boundary)', () => {
    expect(validatePipelineDef(baseDef({
      steps: [{ id: 'collect', customJobRef: 'research/collect', directive: at }],
    }))).toEqual([]);
  });

  it('refuses an approval prompt over the ceiling (same class, same number)', () => {
    const errors = validatePipelineDef(baseDef({
      steps: [
        { id: 'collect', customJobRef: 'research/collect', directive: 'Collect sources' },
        { id: 'gate', type: 'approval', prompt: over },
      ],
    }));
    expect(errors.join('\n')).toMatch(/prompt must be at most/);
  });

  it('the ceiling is the shared constant, not a pipeline-local number', () => {
    const errors = validatePipelineDef(baseDef({
      steps: [{ id: 'collect', customJobRef: 'research/collect', directive: over }],
    }));
    expect(errors.join('\n')).toContain(String(DIRECTIVE_MAX_CHARS));
  });
});

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
    // Directive is optional — an empty step dispatches defaultStepDirective.
    ['step with no directive key', baseDef({
      steps: [{ id: 'collect', customJobRef: 'research/collect' }],
    })],
    ['step with an empty directive', baseDef({
      steps: [{ id: 'collect', customJobRef: 'research/collect', directive: '' }],
    })],
    // Glob pins share the hooks.stop artifact vocabulary.
    ['context glob pin', baseDef({
      steps: [{ id: 'collect', customJobRef: 'research/collect', directive: 'x', context: ['reports/**', 'plan/spec.md'] }],
    })],
    // Manual-only: no trigger block at all — run-now is the only fire source.
    ['manual-only pipeline (no on block)', baseDef({ on: undefined })],
    // runCompleted chaining — alone, and alongside a schedule.
    ['runCompleted trigger alone', baseDef({ on: { runCompleted: { pipelineId: 'weekly-ops' } } })],
    ['runCompleted error-workflow + schedule', baseDef({
      on: {
        schedule: { cron: '0 9 * * 1' },
        runCompleted: { pipelineId: 'weekly-ops', statuses: ['failed', 'partial'] },
      },
    })],
    // Verdict routing — on: verdict:<outcome> edges + onMissingVerdict.
    ['verdict switch with onMissingVerdict fallback', baseDef({
      steps: [
        { id: 'judge', customJobRef: 'x/judge', intent: 'triage', onMissingVerdict: 'needs-review' },
        { id: 'ok', customJobRef: 'x/ok', needs: ['judge'], on: 'verdict:ok' },
        { id: 'review', customJobRef: 'x/review', needs: ['judge'], on: 'verdict:needs-review' },
      ],
    })],
    // Retry / timeout / remindAfter on their legal step kinds.
    ['job step with retry + timeout, gate with remindAfter', baseDef({
      steps: [
        { id: 'a', customJobRef: 'x/a', directive: 'a', retry: { max: 2, backoff: '5m' }, timeout: { after: '2h' } },
        { id: 'g', type: 'approval', prompt: 'p', remindAfter: '24h' },
      ],
    })],
    // Static template vars — directives and pins; prevSuccess watermark pair.
    ['prevSuccess watermark vars in a directive', baseDef({
      steps: [{ id: 'a', customJobRef: 'x/a', directive: 'Since {{run.prevSuccess.fireDate}} ({{run.prevSuccess.fireEpoch}})' }],
    })],
    ['static template vars in a context pin', baseDef({
      steps: [{ id: 'a', customJobRef: 'x/a', directive: 'x', context: ['reports/{{trigger.fireDate}}/**', 'state/{{run.prevSuccess.fireEpoch}}.json'] }],
    })],
    // {{steps.*}} output refs against the (implicit + explicit) needs closure.
    ['steps.*.answer of the implicit previous step', baseDef({
      steps: [
        { id: 'collect', customJobRef: 'research/collect', directive: 'x' },
        { id: 'digest', customJobRef: 'writer/digest', directive: 'Summarize:\n{{steps.collect.answer}}' },
      ],
    })],
    ['steps.*.artifacts across a transitive needs chain', baseDef({
      steps: [
        { id: 'a', customJobRef: 'x/a', directive: 'a' },
        { id: 'b', customJobRef: 'x/b', directive: 'b', needs: ['a'] },
        { id: 'c', customJobRef: 'x/c', directive: '{{steps.a.artifacts}}', needs: ['b'] },
      ],
    })],
  ];

  it.each(valid)('accepts: %s', (_label, def) => {
    expect(validatePipelineDef(def)).toEqual([]);
  });

  const invalid: Array<[string, Record<string, unknown>, RegExp]> = [
    ['v1 version', baseDef({ version: 1 }), /version must be 2/],
    ['wrong version', baseDef({ version: 3 }), /version must be 2/],
    ['v1 enabled key (lives in the availability sidecar)', baseDef({ enabled: true }), /"enabled" lives in the availability sidecar/],
    ['v1 projectId key (moved to activation)', baseDef({ projectId: 'proj-x' }), /"projectId" moved to activation/],
    ['reserved step key jobType (canonical future axis)', baseDef({ steps: [{ id: 'a', customJobRef: 'x/a', directive: 'a', jobType: 'code' }] }), /"jobType" is not supported yet/],
    ['reserved step key feature (canonical future axis)', baseDef({ steps: [{ id: 'a', customJobRef: 'x/a', directive: 'a', feature: 'main' }] }), /"feature" is not supported yet/],
    ['empty name', baseDef({ name: '' }), /name/],
    ['empty on block', baseDef({ on: {} }), /at least one trigger/],
    ['runCompleted with a bad pipeline id', baseDef({ on: { runCompleted: { pipelineId: 'Not Valid!' } } }), /pipelineId must be a pipeline id/],
    ['runCompleted with a non-terminal status', baseDef({ on: { runCompleted: { pipelineId: 'weekly-ops', statuses: ['running'] } } }), /not a terminal run status/],
    ['runCompleted with empty statuses', baseDef({ on: { runCompleted: { pipelineId: 'weekly-ops', statuses: [] } } }), /non-empty array of terminal run statuses/],
    ['4-field cron', baseDef({ on: { schedule: { cron: '0 9 * *' } } }), /5 fields/],
    ['cancelPrevious overlap', baseDef({ on: { schedule: { cron: '0 9 * * 1', overlap: 'cancelPrevious' } } }), /not supported yet/],
    ['unknown top-level key', baseDef({ webhookToken: 'x' }), /unknown key "webhookToken"/],
    // retry / remindAfter are real on their own step kind — cross-kind use is named.
    ['retry on an approval gate', baseDef({ steps: [
      { id: 'a', customJobRef: 'x/a', directive: 'a' },
      { id: 'g', type: 'approval', prompt: 'p', retry: { max: 1 } },
    ] }), /"retry" belongs to job steps/],
    ['remindAfter on a job step', baseDef({ steps: [{ id: 'a', customJobRef: 'x/a', directive: 'a', remindAfter: '4h' }] }), /"remindAfter" belongs to approval steps/],
    ['retry.max over the cap', baseDef({ steps: [{ id: 'a', customJobRef: 'x/a', directive: 'a', retry: { max: 4 } }] }), /retry\.max must be an integer between 1 and 3/],
    ['retry.max zero', baseDef({ steps: [{ id: 'a', customJobRef: 'x/a', directive: 'a', retry: { max: 0 } }] }), /retry\.max must be an integer between 1 and 3/],
    ['bad retry.backoff', baseDef({ steps: [{ id: 'a', customJobRef: 'x/a', directive: 'a', retry: { max: 1, backoff: 'soon' } }] }), /retry\.backoff must be a duration/],
    ['job timeout with onTimeout key', baseDef({ steps: [{ id: 'a', customJobRef: 'x/a', directive: 'a', timeout: { after: '1h', onTimeout: 'reject' } }] }), /unknown key "onTimeout"/],
    ['bad job timeout duration', baseDef({ steps: [{ id: 'a', customJobRef: 'x/a', directive: 'a', timeout: { after: 'later' } }] }), /timeout\.after must be a duration/],
    ['malformed verdict edge', baseDef({ steps: [
      { id: 'a', customJobRef: 'x/a', directive: 'a' },
      { id: 'b', customJobRef: 'x/b', needs: ['a'], on: 'verdict:' },
    ] }), /on must be "success", "failure", "always" or "verdict:<outcome>"/],
    ['onMissingVerdict without a pinned intent', baseDef({ steps: [
      { id: 'a', customJobRef: 'x/a', directive: 'a', onMissingVerdict: 'ok' },
    ] }), /onMissingVerdict needs a pinned intent/],
    ['onMissingVerdict with a bad value', baseDef({ steps: [
      { id: 'a', customJobRef: 'x/a', intent: 'triage', onMissingVerdict: 'Not Valid!' },
    ] }), /onMissingVerdict must be "fail" or an outcome id/],
    ['bad gate remindAfter', baseDef({ steps: [
      { id: 'a', customJobRef: 'x/a', directive: 'a' },
      { id: 'g', type: 'approval', prompt: 'p', remindAfter: 'often' },
    ] }), /remindAfter must be a duration/],
    // {{steps.*}} grammar — answer/artifacts against the needs closure only.
    ['steps.* unknown output field', baseDef({ steps: [
      { id: 'a', customJobRef: 'x/a', directive: 'a' },
      { id: 'b', customJobRef: 'x/b', directive: '{{steps.a.summary}}' },
    ] }), /unknown step-output field/],
    ['steps.*.verdict reserved', baseDef({ steps: [
      { id: 'a', customJobRef: 'x/a', directive: 'a' },
      { id: 'b', customJobRef: 'x/b', directive: '{{steps.a.verdict}}' },
    ] }), /verdict routing is a future axis/],
    ['steps.* self reference', baseDef({ steps: [{ id: 'a', customJobRef: 'x/a', directive: '{{steps.a.answer}}' }] }), /must not reference the step itself/],
    ['steps.* unknown step', baseDef({ steps: [{ id: 'a', customJobRef: 'x/a', directive: '{{steps.ghost.answer}}' }] }), /references unknown step "ghost"/],
    ['steps.* gate reference', baseDef({ steps: [
      { id: 'a', customJobRef: 'x/a', directive: 'a' },
      { id: 'g', type: 'approval', prompt: 'p' },
      { id: 'b', customJobRef: 'x/b', directive: '{{steps.g.answer}}' },
    ] }), /gates have no output/],
    ['steps.* non-upstream reference (sibling branch)', baseDef({ steps: [
      { id: 'a', customJobRef: 'x/a', directive: 'a' },
      { id: 'b', customJobRef: 'x/b', directive: 'b', needs: [] },
      { id: 'c', customJobRef: 'x/c', directive: '{{steps.b.answer}}', needs: ['a'] },
    ] }), /must reference an upstream dependency/],
    ['unknown template var', baseDef({ steps: [{ id: 'a', customJobRef: 'x/a', directive: '{{fireDate}}' }] }), /unknown template variable/],
    ['steps.* ref in a context pin', baseDef({ steps: [
      { id: 'a', customJobRef: 'x/a', directive: 'a' },
      { id: 'b', customJobRef: 'x/b', directive: 'b', context: ['{{steps.a.artifacts}}'] },
    ] }), /step-output references are not allowed in context pins/],
    ['unknown template var in a context pin', baseDef({ steps: [{ id: 'a', customJobRef: 'x/a', directive: 'a', context: ['reports/{{today}}/**'] }] }), /unknown template variable .* in context pin/],
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
    // Gate-anchor rule — pure structure, so it lives in the SHARED validator
    // (the FE save gate must catch it, not a server 400 after the fact).
    ['approval gate as the entry step', baseDef({ steps: [
      { id: 'g', type: 'approval', prompt: 'p' },
      { id: 'a', customJobRef: 'x/a', directive: 'a' },
    ] }), /cannot be the entry step/],
    ['approval gate with explicit empty needs', baseDef({ steps: [
      { id: 'a', customJobRef: 'x/a', directive: 'a' },
      { id: 'g', type: 'approval', prompt: 'p', needs: [] },
    ] }), /cannot be the entry step/],
    ['zero steps', baseDef({ steps: [] }), /non-empty array/],
    ['non-string directive', baseDef({ steps: [{ id: 'a', customJobRef: 'x/a', directive: 42 }] }), /directive must be a string/],
    ['context glob with .. segment', baseDef({ steps: [{ id: 'a', customJobRef: 'x/a', context: ['../*.md'] }] }), /empty, "\." or "\.\." path segment/],
    ['context glob with backslash', baseDef({ steps: [{ id: 'a', customJobRef: 'x/a', context: ['reports\\*.md'] }] }), /posix separators/],
    ['context glob targeting sessions/', baseDef({ steps: [{ id: 'a', customJobRef: 'x/a', context: ['sessions/**'] }] }), /targets sessions\//],
    ['context glob over the length cap', baseDef({ steps: [{ id: 'a', customJobRef: 'x/a', context: [`${'d/'.repeat(120)}*`] }] }), /glob exceeds/],
  ];

  it.each(invalid)('rejects: %s', (_label, def, pattern) => {
    const errors = validatePipelineDef(def);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('\n')).toMatch(pattern);
  });
});

describe('defaultStepDirective — the empty-directive dispatch fallback', () => {
  it('names the pinned intent', () => {
    const text = defaultStepDirective('gather');
    expect(text).toContain('"gather"');
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThanOrEqual(DIRECTIVE_MAX_CHARS);
  });

  it('falls back to the definition-as-specification form without an intent', () => {
    const text = defaultStepDirective(undefined);
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).not.toContain('undefined');
  });

  it('treats the reserved general intent as absent', () => {
    expect(defaultStepDirective('general')).toBe(defaultStepDirective(undefined));
  });

  it('carries no template vars (renderDirective must be a no-op on it)', () => {
    expect(defaultStepDirective('gather')).not.toMatch(/\{\{/);
    expect(defaultStepDirective(undefined)).not.toMatch(/\{\{/);
  });
});

// The gate-anchor rows below exercise the SERVER wrapper on purpose: the rule
// moved into the shared validator, and the wrapper must keep surfacing it.
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

describe('validatePipelineActivation — the self-describing scheduling record', () => {
  const BASE = { pipelineId: 'digest', pipelineScope: 'user', projectId: 'proj-x', activatedAt: '2026-08-20T00:00:00.000Z' };
  const valid: Array<[string, Record<string, unknown>]> = [
    ['minimal binding', { ...BASE }],
    ['org scope with activatedBy', { ...BASE, pipelineScope: 'org', activatedBy: 'user-1' }],
  ];
  it.each(valid)('accepts: %s', (_label, raw) => {
    expect(validatePipelineActivation(raw)).toEqual([]);
  });

  const invalid: Array<[string, unknown, RegExp]> = [
    ['non-object', 'proj-x', /must be an object/],
    ['missing pipelineId (record must self-describe)', { ...BASE, pipelineId: undefined }, /pipelineId/],
    ['bad pipelineScope', { ...BASE, pipelineScope: 'builtin' }, /pipelineScope/],
    ['missing projectId', { ...BASE, projectId: undefined }, /projectId/],
    ['bad timestamp', { ...BASE, activatedAt: 'yesterday' }, /ISO timestamp/],
    ['unknown key', { ...BASE, token: 'x' }, /unknown key "token"/],
    ['featureId reserved (canonical future axis)', { ...BASE, featureId: 'main' }, /not supported yet/],
  ];
  it.each(invalid)('rejects: %s', (_label, raw, pattern) => {
    const errors = validatePipelineActivation(raw);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('\n')).toMatch(pattern);
  });
});
