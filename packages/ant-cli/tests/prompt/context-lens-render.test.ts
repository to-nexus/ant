/**
 * P2 — context-lens partial render locks (e2-humming-spindle).
 *
 * One shared partial (jobs/shared/injections/context-lens.md) renders the
 * projected bands for plan / decompose / triage / detect. Plan's legacy
 * "Recent User Turns" list is superseded when a lens is present.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { FilePromptAdapter, initPartials } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATES_DIR = path.join(__dirname, '../../src/core/prompt/templates');

const LENS = {
  exchanges: [
    {
      turnId: 't1', ts: '2026-07-21T00:00:01Z', jobType: 'design',
      userText: 'pick option A or B',
      assistantFinalText: 'I recommend option B.',
      anchors: { files: ['architecture/spec/x.md'] },
    },
  ],
  digests: [
    {
      turnId: 't0', ts: '2026-07-21T00:00:00Z', jobType: 'code',
      digest: {
        decisions: ['adopted OAuth'],
        constraints: ['모든 응답은 한국어'],
        outcome: 'auth implemented',
        openQuestions: ['rate limit policy?'],
      },
    },
  ],
};

describe('context-lens partial rendering (P2)', () => {
  let adapter: FilePromptAdapter;

  beforeAll(async () => {
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
    await initPartials(TEMPLATES_DIR);
  });

  it('renders exchanges with assistant prose, anchors, and digest fields', async () => {
    const output = await adapter.render('jobs/shared/injections/context-lens', { lens: LENS });

    expect(output).toContain('Recent Exchanges');
    expect(output).toContain('pick option A or B');
    expect(output).toContain('I recommend option B.');
    expect(output).toContain('architecture/spec/x.md');
    expect(output).toContain('Prior Exchange Digests');
    expect(output).toContain('adopted OAuth');
    expect(output).toContain('"모든 응답은 한국어"');
    expect(output).toContain('rate limit policy?');
  });

  it('renders the Standing Constraints ledger (injection floor, P3)', async () => {
    const output = await adapter.render('jobs/shared/injections/context-lens', {
      lens: { exchanges: [], digests: [], constraintLedger: ['절대 라이브러리 추가 금지'] },
    });

    expect(output).toContain('Standing Constraints');
    expect(output).toContain('"절대 라이브러리 추가 금지"');
    expect(output).toContain('BINDING');
  });

  it('plan base: lens supersedes the legacy Recent User Turns list', async () => {
    const vars = {
      featureContext: {
        userTurns: [{ turnId: 't-x', text: 'LEGACY-LIST-ENTRY' }],
        breadcrumbs: [],
      },
      lens: LENS,
      taskName: 'T', taskDescription: 'D', directive: 'do', taskType: 'feature',
      userLanguage: 'en',
    };
    const output = await adapter.render('jobs/code/nodes/plan/base', vars);

    expect(output).toContain('I recommend option B.');
    expect(output).not.toContain('LEGACY-LIST-ENTRY');
  });

  it('plan base: falls back to the user-turns list without a lens', async () => {
    const output = await adapter.render('jobs/code/nodes/plan/base', {
      featureContext: {
        userTurns: [{ turnId: 't-x', text: 'LEGACY-LIST-ENTRY' }],
        breadcrumbs: [],
      },
      taskName: 'T', taskDescription: 'D', directive: 'do', taskType: 'feature',
      userLanguage: 'en',
    });

    expect(output).toContain('LEGACY-LIST-ENTRY');
    expect(output).not.toContain('Recent Exchanges');
  });

  it('triage base: renders the digest band beside the existing user-turn list', async () => {
    const output = await adapter.render('jobs/shared/nodes/triage/variants/default/base', {
      userInput: 'x', currentJob: 'design', currentAgent: 'architect',
      intentCatalog: '',
      featureContext: { userTurns: [{ turnId: 't1', text: 'prior', actionMetadata: {} }], breadcrumbs: [] },
      lens: { exchanges: [], digests: LENS.digests },
    });

    expect(output).toContain('Prior Exchange Digests');
    expect(output).toContain('"모든 응답은 한국어"');
    // Lean: no verbatim exchange band in triage.
    expect(output).not.toContain('Recent Exchanges');
  });
});
