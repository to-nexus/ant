/**
 * Pipeline definition validation — table-driven policy test for the shared
 * structural rules (`validatePipelineDef`) and the server-side additions
 * (`validatePipelineDefServer`: cron min-interval, gate-anchor rule).
 * One axis, one file — add rows here, not new files.
 */

import { describe, it, expect } from 'vitest';
import { validatePipelineDef, validatePipelineActivation, validatePipelineCatalogBinding, collectPipelineDefAdvisories, collectPipelineCatalogAdvisories, collectPipelineAdvisoryItems, defaultStepDirective, PIPELINE_DEF_VERSION, DIRECTIVE_MAX_CHARS } from '@ant/shared';
import type { PipelineCatalogAgent, PipelineDef } from '@ant/shared';
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
    ['verdict disjunction edge (a|b) — a step owed to more than one outcome', baseDef({
      steps: [
        { id: 'judge', customJobRef: 'x/judge', intent: 'triage' },
        { id: 'either', customJobRef: 'x/e', needs: ['judge'], on: 'verdict:ok|needs-review' },
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
    ['malformed verdict disjunction (trailing |)', baseDef({ steps: [
      { id: 'a', customJobRef: 'x/a' },
      { id: 'b', customJobRef: 'x/b', needs: ['a'], on: 'verdict:ok|' },
    ] }), /on must be "success", "failure", "always", "verdict:<outcome>" or "verdict:<a\|b>"/],
    ['malformed verdict edge', baseDef({ steps: [
      { id: 'a', customJobRef: 'x/a', directive: 'a' },
      { id: 'b', customJobRef: 'x/b', needs: ['a'], on: 'verdict:' },
    ] }), /on must be "success", "failure", "always", "verdict:<outcome>" or "verdict:<a\|b>"/],
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
    ] }), /a verdict routes edges/],
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

  // ── approvers map — key = gate stepId, value = lowercase member ids ──
  it('accepts a per-gate approver map; keys checked against gateStepIds when given', () => {
    const raw = { ...BASE, approvers: { 'budget-gate': ['finance@corp.com'], 'publish-gate': ['lead@corp.com', 'finance@corp.com'] } };
    expect(validatePipelineActivation(raw)).toEqual([]);
    expect(validatePipelineActivation(raw, { gateStepIds: ['budget-gate', 'publish-gate'] })).toEqual([]);
  });

  it('a key outside the def gate set fails ONLY when gateStepIds is provided (loads stay lenient)', () => {
    const raw = { ...BASE, approvers: { 'ghost-gate': ['a@corp.com'] } };
    expect(validatePipelineActivation(raw)).toEqual([]);
    const errors = validatePipelineActivation(raw, { gateStepIds: ['budget-gate'] });
    expect(errors.join('\n')).toMatch(/"ghost-gate" is not an approval step/);
  });

  const badApprovers: Array<[string, unknown, RegExp]> = [
    ['non-map approvers', { ...BASE, approvers: ['a@corp.com'] }, /approvers must be a map/],
    ['non-array roster', { ...BASE, approvers: { g1: 'a@corp.com' } }, /must be an array/],
    ['empty-string member', { ...BASE, approvers: { g1: [' '] } }, /non-empty strings/],
    ['non-lowercase member', { ...BASE, approvers: { g1: ['Finance@Corp.com'] } }, /lowercase member id/],
    ['duplicate member in one gate', { ...BASE, approvers: { g1: ['a@corp.com', 'a@corp.com'] } }, /duplicate approver/],
    ['per-gate cap', { ...BASE, approvers: { g1: Array.from({ length: 11 }, (_v, i) => `u${i}@corp.com`) } }, /at most 10 approvers/],
    ['invalid step-id key', { ...BASE, approvers: { 'Bad Gate': ['a@corp.com'] } }, /not a valid step id/],
  ];
  it.each(badApprovers)('rejects approvers: %s', (_label, raw, pattern) => {
    const errors = validatePipelineActivation(raw);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('\n')).toMatch(pattern);
  });
});

describe('validatePipelineCatalogBinding — the definition against the agent catalog', () => {
  // Also the regression test for the shared PipelineCatalog* types (BE↔FE contract).
  const CATALOG: PipelineCatalogAgent[] = [
    {
      id: 'research',
      jobs: [
        { id: 'collect', intents: [{ id: 'gather' }, { id: 'triage', outcomes: ['ok', 'needs-review'] }] },
        { id: 'broken', intents: undefined },
      ],
    },
    { id: 'writer', jobs: [{ id: 'digest', intents: [] }] },
  ];
  const def = (steps: unknown[]): PipelineDef =>
    ({ version: PIPELINE_DEF_VERSION, name: 'n', steps } as unknown as PipelineDef);

  const valid: Array<[string, unknown[]]> = [
    ['known agent/job, no intent', [{ id: 'a', customJobRef: 'research/collect' }]],
    ['known pinned intent', [{ id: 'a', customJobRef: 'research/collect', intent: 'gather' }]],
    ['general intent is reserved, never in the catalog', [{ id: 'a', customJobRef: 'research/collect', intent: 'general' }]],
    ['unparsed intent catalog without an intent pin stays valid', [{ id: 'a', customJobRef: 'research/broken' }]],
    ['verdict edge satisfied by an explicit direct need', [
      { id: 'judge', customJobRef: 'research/collect', intent: 'triage' },
      { id: 'ok', customJobRef: 'writer/digest', needs: ['judge'], on: 'verdict:ok' },
    ]],
    ['verdict edge satisfied by the IMPLICIT previous-step need', [
      { id: 'judge', customJobRef: 'research/collect', intent: 'triage' },
      { id: 'ok', customJobRef: 'writer/digest', on: 'verdict:ok' },
    ]],
    ['onMissingVerdict names a declared outcome', [
      { id: 'judge', customJobRef: 'research/collect', intent: 'triage', onMissingVerdict: 'needs-review' },
    ]],
    ['onMissingVerdict "fail" always passes', [
      { id: 'judge', customJobRef: 'research/collect', intent: 'triage', onMissingVerdict: 'fail' },
    ]],
    ['zero intent features against an empty catalog-shape def', []],
  ];
  it.each(valid)('accepts: %s', (_label, steps) => {
    expect(validatePipelineCatalogBinding(def(steps), CATALOG)).toEqual([]);
  });

  const invalid: Array<[string, unknown[], RegExp]> = [
    // The message MUST name the agent id — an org activator's remedy path.
    ['unknown agent', [{ id: 'a', customJobRef: 'ghost/collect' }], /agent "ghost" is not in your agent catalog/],
    ['unknown job', [{ id: 'a', customJobRef: 'research/publish' }], /agent "research" has no job "publish"/],
    ['unknown pinned intent', [{ id: 'a', customJobRef: 'research/collect', intent: 'nope' }], /no intent "nope"/],
    ['unparsed intent catalog + intent pin', [{ id: 'a', customJobRef: 'research/broken', intent: 'gather' }], /failed to parse/],
    ['verdict edge naming an undeclared outcome', [
      { id: 'judge', customJobRef: 'research/collect', intent: 'triage' },
      { id: 'x', customJobRef: 'writer/digest', needs: ['judge'], on: 'verdict:nope' },
    ], /would always skip/],
    ['verdict edge whose only need is an approval gate', [
      { id: 'judge', customJobRef: 'research/collect', intent: 'triage' },
      { id: 'g', type: 'approval', prompt: 'p', needs: ['judge'] },
      { id: 'x', customJobRef: 'writer/digest', needs: ['g'], on: 'verdict:ok' },
    ], /no direct dependency pins an intent/],
    ['verdict edge whose only need pins no intent', [
      { id: 'a', customJobRef: 'research/collect' },
      { id: 'x', customJobRef: 'writer/digest', needs: ['a'], on: 'verdict:ok' },
    ], /no direct dependency pins an intent/],
    ['onMissingVerdict naming an undeclared outcome', [
      { id: 'judge', customJobRef: 'research/collect', intent: 'triage', onMissingVerdict: 'nope' },
    ], /not an outcome of intent "triage"/],
    ['onMissingVerdict on an outcome-less intent', [
      { id: 'judge', customJobRef: 'research/collect', intent: 'gather', onMissingVerdict: 'ok' },
    ], /declares no outcomes/],
  ];
  it.each(invalid)('rejects: %s', (_label, steps, pattern) => {
    const errors = validatePipelineCatalogBinding(def(steps), CATALOG);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('\n')).toMatch(pattern);
  });

  it('a need whose own catalog rule already errored does not double-error the verdict edge', () => {
    const errors = validatePipelineCatalogBinding(def([
      { id: 'judge', customJobRef: 'ghost/collect', intent: 'triage' },
      { id: 'x', customJobRef: 'writer/digest', needs: ['judge'], on: 'verdict:ok' },
    ]), CATALOG);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/agent "ghost"/);
  });

  it('a disjunction edge is satisfiable when every member is declared', () => {
    const errors = validatePipelineCatalogBinding(def([
      { id: 'judge', customJobRef: 'research/collect', intent: 'triage' },
      { id: 'either', customJobRef: 'writer/digest', needs: ['judge'], on: 'verdict:ok|needs-review' },
    ]), CATALOG);
    expect(errors).toHaveLength(0);
  });

  it("a typo'd disjunction member errors by name — half a branch that always skips", () => {
    const errors = validatePipelineCatalogBinding(def([
      { id: 'judge', customJobRef: 'research/collect', intent: 'triage' },
      { id: 'either', customJobRef: 'writer/digest', needs: ['judge'], on: 'verdict:ok|typo' },
    ]), CATALOG);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/declares outcome "typo"/);
  });
});

describe('collectPipelineDefAdvisories — save-time structural advisories (never the hard gate)', () => {
  const def = (steps: unknown[]): PipelineDef =>
    ({ version: PIPELINE_DEF_VERSION, name: 'n', steps } as unknown as PipelineDef);
  const gate = (id: string, extra: object = {}) => ({ id, type: 'approval', prompt: 'p', ...extra });
  const job = (id: string, extra: object = {}) => ({ id, customJobRef: 'research/collect', ...extra });

  // Gates in these rows carry remindAfter so only the axis under test fires.
  const remind = { remindAfter: '24h' };

  it('flags an approval gate no step needs (terminal gate = seam, not gate)', () => {
    const advisories = collectPipelineDefAdvisories(def([job('a'), gate('g', { needs: ['a'], ...remind })]));
    expect(advisories).toHaveLength(1);
    expect(advisories[0]).toMatch(/approval step "g" holds back nothing/);
  });

  // The small-farming-medal shape: two gates, no timeout, no remindAfter — a
  // parked run nobody is ever reminded of. The authoring contract requires
  // remindAfter on gates whose timeout is long or absent; this is its gate.
  it('flags a gate with neither timeout nor remindAfter; silent when either is set', () => {
    const bare = collectPipelineDefAdvisories(def([job('a'), gate('g'), job('b')]));
    expect(bare).toHaveLength(1);
    expect(bare[0]).toMatch(/approval step "g" waits forever and reminds nobody/);
    expect(collectPipelineDefAdvisories(def([job('a'), gate('g', { remindAfter: '4h' }), job('b')]))).toHaveLength(0);
    expect(
      collectPipelineDefAdvisories(def([job('a'), gate('g', { timeout: { after: '24h', onTimeout: 'reject' } }), job('b')])),
    ).toHaveLength(0);
  });

  it('a gate depended on explicitly, or implicitly as the previous step in file order, is silent', () => {
    expect(collectPipelineDefAdvisories(def([job('a'), gate('g', { needs: ['a'], ...remind }), job('b', { needs: ['g'] })]))).toHaveLength(0);
    expect(collectPipelineDefAdvisories(def([job('a'), gate('g', remind), job('b')]))).toHaveLength(0);
  });

  it('a terminal JOB step is not flagged — the rule is about undecided decisions, not leaves', () => {
    expect(collectPipelineDefAdvisories(def([job('a'), job('b')]))).toHaveLength(0);
  });
});

describe('collectPipelineCatalogAdvisories — pin-needs coherence (save advisory, never the hard gate)', () => {
  // The F31 shape: a step pins a sibling producer's stop glob without carrying
  // the producer in its needs closure — wired by file-order luck.
  const CATALOG: PipelineCatalogAgent[] = [
    {
      id: 'terms',
      jobs: [
        {
          id: 'notice',
          intents: [
            { id: 'publishing', hooks: { stop: [{ artifact: 'terms/*/publishing-request.md' }] } },
            { id: 'extract', hooks: { stop: [{ artifact: 'terms/*/extract-request.md' }] } },
            { id: 'mail', hooks: { stop: [{ artifact: 'terms/*/mail-request.md' }, { action: 'api__ant__request' }] } },
            // Outcome-declaring, no stop glob — only the verdict rows below pin it.
            { id: 'judge', outcomes: ['ok', 'needs-review'] },
          ],
        },
      ],
    },
  ];
  const def = (steps: unknown[]): PipelineDef =>
    ({ version: PIPELINE_DEF_VERSION, name: 'n', steps } as unknown as PipelineDef);
  const step = (id: string, intent: string, extra: object = {}) =>
    ({ id, customJobRef: 'terms/notice', intent, ...extra });
  // Rows testing another axis thread the case, so the case-identity rule stays quiet.
  const threadRef = '이번 케이스: {{steps.publishing.answer}}';

  // The smooth-mending-coral shape: four outcome-declaring intents, no verdict
  // edge anywhere, no onMissingVerdict — one forgotten <verdict> tag fails the
  // step and aborts a run that may have cleared two human gates, for a decision
  // nothing downstream reads.
  it('flags an outcome-declaring step that nothing routes on and that has no onMissingVerdict', () => {
    const bare = collectPipelineAdvisoryItems(def([step('decide', 'judge'), step('mail', 'mail')]), CATALOG);
    expect(bare).toHaveLength(1);
    expect(bare[0]).toMatchObject({ code: 'unrouted-verdict-no-fallback', stepId: 'decide', field: 'onMissingVerdict' });
    expect(bare[0].message).toMatch(/declares outcomes \(ok, needs-review\), but no edge routes on its verdict/);

    // A fallback silences it — the run continues on a sealed default.
    expect(collectPipelineAdvisoryItems(def([step('decide', 'judge', { onMissingVerdict: 'needs-review' }), step('mail', 'mail')]), CATALOG)).toHaveLength(0);
    // A downstream verdict edge silences it — the fallback is then a routing choice, judged by the validator.
    expect(
      collectPipelineAdvisoryItems(
        def([step('decide', 'judge'), step('mail', 'mail', { on: 'verdict:ok' })]),
        CATALOG,
      ),
    ).toHaveLength(0);
    // Steps whose intent declares no outcomes are never flagged.
    expect(collectPipelineAdvisoryItems(def([step('publishing', 'publishing'), step('mail', 'mail', { context: ['terms/*/publishing-request.md'], directive: threadRef })]), CATALOG)).toHaveLength(0);
  });

  it('flags a pin whose producer step is not in the needs closure (F31)', () => {
    const advisories = collectPipelineCatalogAdvisories(
      def([
        step('publishing', 'publishing'),
        step('extract', 'extract', { needs: [] }),
        step('mail', 'mail', { needs: ['extract'], context: ['terms/*/publishing-request.md'] }),
      ]),
      CATALOG,
    );
    expect(advisories).toHaveLength(1);
    expect(advisories[0]).toMatch(/step "mail" pins "terms\/\*\/publishing-request\.md" produced by step "publishing"/);
    expect(advisories[0]).toMatch(/what you pin, you needs/);
  });

  it('silent when the producer is in the TRANSITIVE needs chain, including through an approval gate', () => {
    const advisories = collectPipelineCatalogAdvisories(
      def([
        step('publishing', 'publishing'),
        { id: 'gate', type: 'approval', prompt: 'p', needs: ['publishing'] },
        step('mail', 'mail', { needs: ['gate'], context: ['terms/*/publishing-request.md'], directive: threadRef }),
      ]),
      CATALOG,
    );
    expect(advisories).toHaveLength(0);
  });

  it('implicit needs (omitted = previous step in file order) count as the chain', () => {
    const advisories = collectPipelineCatalogAdvisories(
      def([step('publishing', 'publishing'), step('mail', 'mail', { context: ['terms/*/publishing-request.md'], directive: threadRef })]),
      CATALOG,
    );
    expect(advisories).toHaveLength(0);
  });

  // The small-farming-medal shape: the ENTRY step pinned its own intent's stop
  // glob — a fresh project has no match, dispatch fails the step, abort kills
  // the run. The self-filter of the needs rule silenced it; it is its own row.
  it('flags a step that pins its own intent\'s stop glob (self-pin) — entry step or not', () => {
    const entry = collectPipelineCatalogAdvisories(
      def([step('lookup', 'publishing', { context: ['terms/*/publishing-request.md'] }), step('mail', 'mail')]),
      CATALOG,
    );
    expect(entry).toHaveLength(1);
    expect(entry[0]).toMatch(/step "lookup" pins "terms\/\*\/publishing-request\.md", its own intent's stop artifact/);
    expect(entry[0]).toMatch(/matches nothing and the step fails at dispatch/);

    const downstream = collectPipelineCatalogAdvisories(
      def([step('publishing', 'publishing'), step('mail', 'mail', { context: ['terms/*/publishing-request.md', 'terms/*/mail-request.md'], directive: threadRef })]),
      CATALOG,
    );
    expect(downstream).toHaveLength(1);
    expect(downstream[0]).toMatch(/step "mail" pins "terms\/\*\/mail-request\.md", its own intent's stop artifact/);
  });

  it('no claim for pins matching no sibling stop glob (external inputs), or when any duplicate producer is an ancestor', () => {
    expect(
      collectPipelineCatalogAdvisories(
        def([step('a', 'publishing'), step('b', 'mail', { needs: [], context: ['resource/manual.html'] })]),
        CATALOG,
      ),
    ).toHaveLength(0);
    expect(
      collectPipelineCatalogAdvisories(
        def([
          step('p1', 'publishing'),
          step('p2', 'publishing', { needs: [] }),
          step('mail', 'mail', { needs: ['p1'], context: ['terms/*/publishing-request.md'], directive: threadRef }),
        ]),
        CATALOG,
      ),
    ).toHaveLength(0);
  });

  // The small-farming-medal shape, second half: every downstream pin is a
  // domain-keyed `*` glob and no directive carries a template reference, so
  // the case the run learned through clarify never reaches the consumer.
  it('flags a `*` pin from an upstream producer when the directive carries no template reference', () => {
    const advisories = collectPipelineCatalogAdvisories(
      def([
        step('publishing', 'publishing'),
        step('mail', 'mail', { context: ['terms/*/publishing-request.md'], directive: '메일 발송 요청 규격을 준비한다.' }),
      ]),
      CATALOG,
    );
    expect(advisories).toHaveLength(1);
    expect(advisories[0]).toMatch(/step "mail" pins "terms\/\*\/publishing-request\.md" — a domain-keyed glob/);
    // Two `*` pins on one step → ONE advisory naming both, not one per pin.
    const twoPins = collectPipelineCatalogAdvisories(
      def([
        step('publishing', 'publishing'),
        step('extract', 'extract'),
        step('mail', 'mail', { needs: ['publishing', 'extract'], context: ['terms/*/publishing-request.md', 'terms/*/extract-request.md'] }),
      ]),
      CATALOG,
    );
    expect(twoPins).toHaveLength(1);
    expect(twoPins[0]).toMatch(/"terms\/\*\/publishing-request\.md", "terms\/\*\/extract-request\.md"/);
    expect(advisories[0]).toMatch(/\{\{steps\.publishing\.artifacts\}\}/);
    // An omitted directive is the default "carry out this intent" — no reference either.
    expect(
      collectPipelineCatalogAdvisories(def([step('publishing', 'publishing'), step('mail', 'mail', { context: ['terms/*/publishing-request.md'] })]), CATALOG),
    ).toHaveLength(1);
  });

  it('silent when the directive threads the case (steps.* ref or a static variable), or the pin has no `*`', () => {
    const threaded = (directive: string) =>
      collectPipelineCatalogAdvisories(
        def([step('publishing', 'publishing'), step('mail', 'mail', { context: ['terms/*/publishing-request.md'], directive })]),
        CATALOG,
      );
    expect(threaded('이번 케이스: {{steps.publishing.answer}}')).toHaveLength(0);
    expect(threaded('파일: {{steps.publishing.artifacts}}')).toHaveLength(0);
    expect(threaded('주간 {{trigger.fireDate}} 기준')).toHaveLength(0);
    expect(
      collectPipelineCatalogAdvisories(
        def([step('publishing', 'publishing'), step('mail', 'mail', { context: ['terms/acme/publishing-request.md'] })]),
        CATALOG,
      ),
    ).toHaveLength(0);
  });

  it('structured items anchor each finding to its step and field (the string collectors are their map)', () => {
    const pipeline = def([
      step('lookup', 'publishing', { context: ['terms/*/publishing-request.md'] }),
      { id: 'gate', type: 'approval', prompt: 'p' },
      step('mail', 'mail', { context: ['terms/*/publishing-request.md'] }),
    ]);
    const items = collectPipelineAdvisoryItems(pipeline, CATALOG);
    expect(items.map((a) => [a.code, a.stepId, a.field])).toEqual([
      ['gate-waits-forever', 'gate', 'timeout'],
      ['self-pin', 'lookup', 'context'],
      ['case-identity-not-threaded', 'mail', 'directive'],
    ]);
    expect(items.map((a) => a.message)).toEqual([
      ...collectPipelineDefAdvisories(pipeline),
      ...collectPipelineCatalogAdvisories(pipeline, CATALOG),
    ]);
  });

  // The F34 shape (chained pipelines only): the chain restriction over-applied,
  // so a consumer downstream of a glob-declaring producer ships with zero pins.
  const chainDef = (steps: unknown[]): PipelineDef =>
    ({
      version: PIPELINE_DEF_VERSION,
      name: 'n',
      on: { runCompleted: { pipelineId: 'up' } },
      steps,
    } as unknown as PipelineDef);

  it('chained pipeline: flags a pinless consumer whose upstream step declares stop globs (F34)', () => {
    const advisories = collectPipelineCatalogAdvisories(
      chainDef([step('publishing', 'publishing'), step('mail', 'mail')]),
      CATALOG,
    );
    expect(advisories).toHaveLength(1);
    expect(advisories[0]).toMatch(/chained pipeline: step "mail" pins nothing while its upstream steps declare "terms\/\*\/publishing-request\.md"/);
    expect(advisories[0]).toMatch(/within this pipeline the duty is unchanged/);
  });

  it('chained pipeline: silent for the entry step, and for a consumer that pins its upstream glob', () => {
    expect(
      collectPipelineCatalogAdvisories(
        chainDef([step('publishing', 'publishing'), step('mail', 'mail', { context: ['terms/*/publishing-request.md'], directive: threadRef })]),
        CATALOG,
      ),
    ).toHaveLength(0);
  });

  it('not a chained pipeline: the pinless-consumer advisory does not fire (scope = on.runCompleted only)', () => {
    expect(
      collectPipelineCatalogAdvisories(
        def([step('publishing', 'publishing'), step('mail', 'mail')]),
        CATALOG,
      ),
    ).toHaveLength(0);
  });
});

describe('collectPipelineCatalogAdvisories — entry-no-case-channel (the rapid-killing-pilot shape)', () => {
  // Nine intents authored `clarify: false` with no rule for the knob; the manual
  // pipeline's entry pinned nothing and threaded nothing, so Run now would write
  // a case nobody supplied and seal completed.
  const CATALOG: PipelineCatalogAgent[] = [
    {
      id: 'terms',
      jobs: [
        {
          id: 'notice',
          intents: [
            { id: 'plan', clarify: false, hooks: { stop: [{ artifact: 'terms/*/schedule.md' }] } },
            { id: 'plan-asks', hooks: { stop: [{ artifact: 'terms/*/schedule.md' }] } },
            { id: 'ledger', clarify: false, hooks: { stop: [{ artifact: 'ledger/summary.md' }] } },
            { id: 'legal', hooks: { stop: [{ artifact: 'terms/*/legal-request.md' }] } },
          ],
        },
      ],
    },
  ];
  const def = (steps: unknown[], on?: object): PipelineDef =>
    ({ version: PIPELINE_DEF_VERSION, name: 'n', ...(on !== undefined && { on }), steps } as unknown as PipelineDef);
  const step = (id: string, intent: string, extra: object = {}) =>
    ({ id, customJobRef: 'terms/notice', intent, ...extra });
  const hits = (pipeline: PipelineDef) =>
    collectPipelineCatalogAdvisories(pipeline, CATALOG).filter((m) => m.includes('no channel to learn its case'));

  it('fires for a manual entry that pins nothing, threads nothing, and runs a clarify:false intent on a case-keyed path', () => {
    const items = collectPipelineAdvisoryItems(
      def([step('plan', 'plan'), step('legal', 'legal', { context: ['terms/*/schedule.md'], directive: '{{steps.plan.artifacts}}' })]),
      CATALOG,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ code: 'entry-no-case-channel', stepId: 'plan', field: 'directive' });
    expect(items[0].message).toMatch(/intent "plan" declares clarify: false/);
    expect(items[0].message).toMatch(/seal a case nobody supplied/);
  });

  it.each([
    ['the intent does not declare the knob (the job/agent default is not inferred)', def([step('plan', 'plan-asks')])],
    ["the entry pins a previous pipeline's artifact", def([step('plan', 'plan', { context: ['terms/*/legal-request.md'] })])],
    ['the directive carries a run-known value', def([step('plan', 'plan', { directive: 'case {{run.id}}' })])],
    ['the pipeline fires on a schedule (the fire is the input)', def([step('plan', 'plan')], { schedule: { cron: '0 9 * * 1' } })],
    ['the step is not the entry', def([step('legal', 'legal'), step('plan', 'plan', { needs: ['legal'] })])],
    ['the intent writes a fixed, case-free path', def([step('ledger', 'ledger')])],
  ])('stays silent when %s', (_label, pipeline) => {
    expect(hits(pipeline)).toHaveLength(0);
  });
});
