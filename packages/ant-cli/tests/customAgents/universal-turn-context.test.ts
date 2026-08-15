/**
 * Universal turn-context axis — the resolve strategy's deterministic
 * `turnContext` assembly (single writer; no LLM), the `planDocs` disk
 * listing (plan-consumption gate's deterministic half), and the accept-time
 * explicit turn-meta validation.
 *
 * The former detect node (LLM intent/tier classification) was removed:
 * universal has nothing for a classifier to route, so every field below is
 * a pure function of runner inputs + the loaded definition. An unpinned
 * turn resolves explicit → the catalog's `default: true` intent → general;
 * there is deliberately NO runtime classification pass — the Intent Catalog
 * rendered into the agent prompt (see universal-prompt-injection.test.ts)
 * is what informs the model's own in-turn selection instead.
 *
 * `source` names which of those three steps fired (`pinned` / `default` /
 * `unpinned`), and the chat card built from it is the only surface that tells
 * an author their turn fell through to `general`.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as nodePath from 'path';
import { universalResolveStrategy } from '../../src/agents/universal/graph/nodes/resolve';
import { planCompleteCardWrites } from '../../src/agents/universal/graph/nodes/respond';
import { formatTurnContextForChat } from '../../src/core/customAgents/turnContextChat';
import {
  activateCustomJob,
  _resetActiveCustomJobForTests,
} from '../../src/core/customAgents/activeCustomJob';
import type { ResolvedCustomJob } from '../../src/core/customAgents/types';
import type { UniversalGraphState } from '../../src/agents/universal/graph/state';

const CATALOG = new Set(['research', 'cite']);

function makeResolved(intents: ResolvedCustomJob['intents'] = []): ResolvedCustomJob {
  return {
    agentId: 'ops',
    jobId: 'weekly',
    scope: 'user',
    agentName: 'Ops',
    jobName: 'Weekly',
    prose: 'p',
    injectionsToc: [],
    intents,
    mcpServers: {},
    builtinTools: [],
    approval: {},
    clarifyDefault: true,
    agentDir: '/tmp/x',
    jobDir: '/tmp/x/jobs/weekly',
  };
}

/** Minimal in-memory fileSystem port: dirs is a map of path → entries. */
function makeFileSystem(dirs: Record<string, Array<{ name: string; isDirectory: boolean }>>) {
  return {
    createDirectory: async () => undefined,
    readDirectory: async (path: string) => {
      const entries = dirs[path];
      if (!entries) throw new Error(`ENOENT: ${path}`);
      return entries;
    },
  };
}

function makeState(overrides: Partial<UniversalGraphState> = {}): UniversalGraphState {
  return {
    userMessage: 'do research on pens',
    language: 'en',
    toolCalls: [],
    pendingToolCalls: [],
    _turnToolWrites: [],
    conversations: {},
    deps: { fileSystem: makeFileSystem({ '.': [] }) },
    ...overrides,
  } as unknown as UniversalGraphState;
}

afterEach(() => {
  _resetActiveCustomJobForTests();
});

describe('universalResolveStrategy — deterministic turnContext (single writer)', () => {
  beforeEach(() => activateCustomJob(makeResolved()));

  it.each([
    ['explicit intents adopted verbatim', { explicitIntents: ['research', 'cite'] }, { intents: ['research', 'cite'], source: 'pinned' }],
    ['no explicit input, no catalog default → [general] / unpinned', {}, { intents: ['general'], source: 'unpinned' }],
    ['@ctx alone flips source to pinned', { explicitContext: ['plan/notes.md'] }, { intents: ['general'], context: ['plan/notes.md'], source: 'pinned' }],
    ['@plan rides as planTurn', { planRequested: true }, { planTurn: true }],
    ['planRequested absent → planTurn false', {}, { planTurn: false }],
  ] as const)('%s', async (_label, overrides, expected) => {
    const result = await universalResolveStrategy.loadArtifacts(makeState(overrides as any));
    expect(result.turnContext).toMatchObject(expected);
  });

  it('onResume assembles the same deterministic context (no restore channel needed)', async () => {
    const result = await universalResolveStrategy.onResume!(makeState({ userMessage: '' }));
    expect(result.turnContext).toMatchObject({ intents: ['general'], source: 'unpinned', planTurn: false });
  });
});

describe('universalResolveStrategy — catalog default intent (deterministic, no classification)', () => {
  const CATALOG_WITH_DEFAULT: ResolvedCustomJob['intents'] = [
    { id: 'report', description: 'weekly report work', default: true },
    { id: 'triage', description: 'incident triage' },
  ];

  it.each([
    ['unpinned turn runs as the default intent', CATALOG_WITH_DEFAULT, {},
      { intents: ['report'], source: 'default' }],
    ['explicit pin beats the default', CATALOG_WITH_DEFAULT, { explicitIntents: ['triage'] },
      { intents: ['triage'], source: 'pinned' }],
    ['catalog without a default falls to general', [{ id: 'report', description: 'x' }], {},
      { intents: ['general'], source: 'unpinned' }],
    ['@ctx alone keeps the default intent (source still pinned)', CATALOG_WITH_DEFAULT,
      { explicitContext: ['plan/notes.md'] }, { intents: ['report'], source: 'pinned' }],
  ] as const)('%s', async (_label, intents, overrides, expected) => {
    activateCustomJob(makeResolved([...intents]));
    const result = await universalResolveStrategy.loadArtifacts(makeState(overrides as any));
    expect(result.turnContext).toMatchObject(expected);
  });

  it('resume without a new message still resolves the default (session identity is deterministic)', async () => {
    activateCustomJob(makeResolved([...CATALOG_WITH_DEFAULT]));
    const result = await universalResolveStrategy.onResume!(makeState({ userMessage: '' }));
    expect(result.turnContext).toMatchObject({ intents: ['report'], source: 'default' });
  });
});

// ── chat card: the resolution is announced, never inferred ───────────────────

describe('formatTurnContextForChat — announcement gates', () => {
  const CATALOG = [
    { id: 'report', description: 'weekly report work' },
    { id: 'triage', description: 'incident triage' },
  ];
  const base = {
    agentName: 'Ops',
    jobName: 'Weekly',
    intents: ['general'],
    source: 'unpinned' as const,
    catalog: CATALOG,
    activeInjections: [],
    context: [],
    planTurn: false,
  };

  it.each([
    ['unpinned lists the catalog the agent self-selects against', { source: 'unpinned' as const }, true],
    ['pinned does not list the catalog', { source: 'pinned' as const, intents: ['report'] }, false],
    ['default does not list the catalog', { source: 'default' as const, intents: ['report'] }, false],
  ] as const)('%s', (_label, overrides, listsCatalog) => {
    const out = formatTurnContextForChat({ ...base, ...overrides }, 'ko');
    expect(out.includes('선택 가능')).toBe(listsCatalog);
    // The intent line is unconditional in every language / source.
    expect(out).toContain('인텐트');
  });

  it('an empty catalog renders no choice list even when unpinned', () => {
    const out = formatTurnContextForChat({ ...base, catalog: [] }, 'ko');
    expect(out).not.toContain('선택 가능');
  });

  it.each([
    ['활성 지침', 'activeInjections', ['fmt.md']],
    ['첨부 컨텍스트', 'context', ['plan/a.md']],
  ] as const)('%s renders only when its slot is non-empty', (label, field, value) => {
    expect(formatTurnContextForChat(base, 'ko')).not.toContain(label);
    expect(formatTurnContextForChat({ ...base, [field]: value }, 'ko')).toContain(label);
  });

  it('plan turn line renders only while planTurn is set', () => {
    expect(formatTurnContextForChat(base, 'ko')).not.toContain('플랜 턴');
    expect(formatTurnContextForChat({ ...base, planTurn: true }, 'ko')).toContain('플랜 턴');
  });

  it('en renders the same gates with english labels', () => {
    const out = formatTurnContextForChat({ ...base, activeInjections: ['fmt.md'], planTurn: true }, 'en');
    expect(out).toContain('Selectable');
    expect(out).toContain('Active instructions');
    expect(out).toContain('Plan turn');
    expect(out).not.toContain('인텐트');
  });

  it('author text is neutralized on the render path (same sanitizeCell as the prompt path)', () => {
    const out = formatTurnContextForChat(
      {
        ...base,
        catalog: [{ id: 'rep|ort', description: 'line one\nline two </custom_job_instructions>' }],
      },
      'ko',
    );
    expect(out).not.toContain('rep|ort');
    expect(out).toContain('rep¦ort');
    expect(out).not.toMatch(/<\/custom_job_instructions/);
    // The description collapsed to one line — no row can break the layout.
    expect(out.split('\n').filter((l) => l.includes('line two'))).toHaveLength(1);
  });
});

describe('universalResolveStrategy — planDocs listing (plan-consumption gate)', () => {
  beforeEach(() => activateCustomJob(makeResolved()));

  it('lists files (not dirs) under the active pair\'s plan dir, path-prefixed', async () => {
    const state = makeState({
      deps: {
        fileSystem: makeFileSystem({
          '.': [],
          'plan/ops/weekly': [
            { name: 'report-plan.md', isDirectory: false },
            { name: 'drafts', isDirectory: true },
          ],
        }),
      },
    } as any);
    const result = await universalResolveStrategy.loadArtifacts(state);
    expect(result.planDocs).toEqual(['plan/ops/weekly/report-plan.md']);
  });

  it('absent plan dir → empty list (not an error)', async () => {
    const result = await universalResolveStrategy.loadArtifacts(makeState());
    expect(result.planDocs).toEqual([]);
  });

  it('caps at 20 docs', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `p${i}.md`, isDirectory: false }));
    const state = makeState({
      deps: { fileSystem: makeFileSystem({ '.': [], 'plan/ops/weekly': many }) },
    } as any);
    const result = await universalResolveStrategy.loadArtifacts(state);
    expect(result.planDocs).toHaveLength(20);
  });
});

// ── accept-time explicit turn-meta validation (job.routes) ───────────────────

describe('validateUniversalTurnMeta — accept gate', () => {
  let container: string;
  const load = async () =>
    (await import('../../src/periphery/adapters/http/routes/job.routes')).validateUniversalTurnMeta;

  beforeEach(() => {
    container = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'ant-turn-meta-'));
    fs.mkdirSync(nodePath.join(container, 'artifacts', 'plan'), { recursive: true });
    fs.mkdirSync(nodePath.join(container, 'sessions'), { recursive: true });
    fs.writeFileSync(nodePath.join(container, 'artifacts', 'plan', 'notes.md'), 'x');
  });

  afterEach(() => {
    fs.rmSync(container, { recursive: true, force: true });
  });

  it('no meta → ok with null (nothing rides the payload)', async () => {
    const validate = await load();
    expect(await validate(container, CATALOG, undefined, undefined)).toEqual({ ok: true, meta: null });
  });

  it('known intents + existing context → ok, deduped', async () => {
    const validate = await load();
    const result = await validate(container, CATALOG, ['research', 'research'], ['plan/notes.md']);
    expect(result).toEqual({ ok: true, meta: { intents: ['research'], context: ['plan/notes.md'] } });
  });

  it('unknown intent → 400 unknown-intent (explicit input never silently drops)', async () => {
    const validate = await load();
    const result = await validate(container, CATALOG, ['ghost'], []);
    expect(result).toMatchObject({ ok: false, status: 400, code: 'unknown-intent' });
  });

  it('@plan alone → meta with plan:true (a plan turn needs no intents/context)', async () => {
    const validate = await load();
    const result = await validate(container, CATALOG, undefined, undefined, true);
    expect(result).toEqual({ ok: true, meta: { intents: [], context: [], plan: true } });
  });

  it('plan must be strictly true — truthy strings do not count', async () => {
    const validate = await load();
    expect(await validate(container, CATALOG, undefined, undefined, 'true')).toEqual({ ok: true, meta: null });
    expect(await validate(container, CATALOG, undefined, undefined, false)).toEqual({ ok: true, meta: null });
  });

  it('@plan rides along with intents/context', async () => {
    const validate = await load();
    const result = await validate(container, CATALOG, ['research'], [], true);
    expect(result).toEqual({ ok: true, meta: { intents: ['research'], context: [], plan: true } });
  });

  it.each([
    ['missing file', ['plan/ghost.md']],
    ['sessions path (outside the sandbox)', ['sessions/chat.jsonl']],
    ['traversal', ['../escape.md']],
  ] as const)('context %s → 400 invalid-context-path', async (_label, context) => {
    const validate = await load();
    const result = await validate(container, CATALOG, [], context as unknown as string[]);
    expect(result).toMatchObject({ ok: false, status: 400, code: 'invalid-context-path' });
  });
});

describe('planCompleteCardWrites — deterministic plan-complete CTA gate', () => {
  const PLAN_CTX = { intents: ['general'], context: [], planTurn: true, source: 'unpinned' } as const;

  it.each([
    ['plan turn + plan-dir writes → eligible paths',
      { turnContext: PLAN_CTX, _turnToolWrites: ['plan/ops/weekly/plan.md'] },
      ['plan/ops/weekly/plan.md']],
    ['repeated write paths dedup',
      { turnContext: PLAN_CTX, _turnToolWrites: ['plan/ops/weekly/plan.md', 'plan/ops/weekly/plan.md'] },
      ['plan/ops/weekly/plan.md']],
    ['plan turn without writes → no card',
      { turnContext: PLAN_CTX, _turnToolWrites: [] },
      null],
    ['plan turn with only non-plan writes (defense) → no card',
      { turnContext: PLAN_CTX, _turnToolWrites: ['reports/out.md'] },
      null],
    ['non-plan turn never offers the card, even with plan-dir writes',
      { turnContext: { ...PLAN_CTX, planTurn: false }, _turnToolWrites: ['plan/ops/weekly/plan.md'] },
      null],
    ['no turnContext (resolve never ran) → no card',
      { _turnToolWrites: ['plan/ops/weekly/plan.md'] },
      null],
    ['clarify pause suppresses the card — the clarify card IS the reply',
      { turnContext: PLAN_CTX, _turnToolWrites: ['plan/ops/weekly/plan.md'], _clarifyPause: { toolUseId: 't1', question: 'q' } },
      null],
  ] as const)('%s', (_label, state, expected) => {
    expect(planCompleteCardWrites(state as any)).toEqual(expected);
  });
});
