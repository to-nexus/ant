/**
 * Universal turn-context axis — the resolve strategy's deterministic
 * `turnContext` assembly (single writer; no LLM), the `planDocs` disk
 * listing (plan-consumption gate's deterministic half), and the accept-time
 * explicit turn-meta validation.
 *
 * The former detect node (LLM intent/tier classification) was removed:
 * universal has nothing for a classifier to route, so every field below is
 * a pure function of runner inputs + the loaded definition. Intents resolve
 * explicit → inherited (clarify continuity) → general; there is deliberately
 * NO runtime classification pass and NO catalog default — the Intent Catalog
 * rendered into the agent prompt (see universal-prompt-injection.test.ts) is
 * what informs the model's own in-turn selection instead.
 *
 * `source` names which of those three steps fired for the INTENT facet
 * (`pinned` / `inherited` / `unpinned`), and the chat card built from it is
 * the only surface that tells an author their turn fell through to
 * `general`.
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
    intents,
    intentPrompts: {},
    mcpServers: {},
    apiServers: {},
    onDemandDocs: [],
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
    ['explicit intent adopted verbatim', { explicitIntents: ['research'] }, { intents: ['research'], source: 'pinned' }],
    ['no explicit input → [general] / unpinned', {}, { intents: ['general'], source: 'unpinned' }],
    ['@ctx alone attaches context without forging intent provenance', { explicitContext: ['plan/notes.md'] }, { intents: ['general'], context: ['plan/notes.md'], source: 'unpinned' }],
    ['@plan rides as planTurn', { planRequested: true }, { planTurn: true }],
    ['planRequested absent → planTurn false', {}, { planTurn: false }],
    ['inherited context adopted on a clarify answer turn (nothing explicit)',
      { inheritedTurnContext: { intents: ['research'], context: ['plan/notes.md'], planTurn: false } },
      { intents: ['research'], context: ['plan/notes.md'], source: 'inherited' }],
    ['explicit pin on the answer turn beats inheritance',
      { explicitIntents: ['cite'], inheritedTurnContext: { intents: ['research'], context: [], planTurn: false } },
      { intents: ['cite'], source: 'pinned' }],
    ['inherited planTurn survives (plan confinement never drops mid-plan)',
      { inheritedTurnContext: { intents: ['research'], context: [], planTurn: true } },
      { planTurn: true, source: 'inherited' }],
    ['explicit @ctx replaces inherited context but intents still inherit',
      { explicitContext: ['plan/other.md'], inheritedTurnContext: { intents: ['research'], context: ['plan/notes.md'], planTurn: false } },
      { intents: ['research'], context: ['plan/other.md'], source: 'inherited' }],
    ['contentless inheritance (intents empty) falls through to unpinned',
      { inheritedTurnContext: { intents: [], context: ['plan/notes.md'], planTurn: false } },
      { intents: ['general'], context: ['plan/notes.md'], source: 'unpinned' }],
  ] as const)('%s', async (_label, overrides, expected) => {
    const result = await universalResolveStrategy.loadArtifacts(makeState(overrides as any));
    expect(result.turnContext).toMatchObject(expected);
  });

  it('onResume assembles the same deterministic context (no restore channel needed)', async () => {
    const result = await universalResolveStrategy.onResume!(makeState({ userMessage: '' }));
    expect(result.turnContext).toMatchObject({ intents: ['general'], source: 'unpinned', planTurn: false });
  });
});

describe('universalResolveStrategy — no catalog default (unpinned is always general)', () => {
  const CATALOG_INTENTS: ResolvedCustomJob['intents'] = [
    { id: 'report', infer: 'weekly report work' },
    { id: 'triage', infer: 'incident triage' },
  ];

  it.each([
    ['unpinned turn with a populated catalog still runs as general', {},
      { intents: ['general'], source: 'unpinned' }],
    ['explicit pin adopts the catalog intent', { explicitIntents: ['triage'] },
      { intents: ['triage'], source: 'pinned' }],
    ['@ctx alone keeps general (source stays unpinned)', { explicitContext: ['plan/notes.md'] },
      { intents: ['general'], context: ['plan/notes.md'], source: 'unpinned' }],
    ['inheritance keeps the paused pin (clarify answer turn)',
      { inheritedTurnContext: { intents: ['triage'], context: [], planTurn: false } },
      { intents: ['triage'], source: 'inherited' }],
  ] as const)('%s', async (_label, overrides, expected) => {
    activateCustomJob(makeResolved([...CATALOG_INTENTS]));
    const result = await universalResolveStrategy.loadArtifacts(makeState(overrides as any));
    expect(result.turnContext).toMatchObject(expected);
  });

  it('resume without a new message resolves general (session identity is deterministic)', async () => {
    activateCustomJob(makeResolved([...CATALOG_INTENTS]));
    const result = await universalResolveStrategy.onResume!(makeState({ userMessage: '' }));
    expect(result.turnContext).toMatchObject({ intents: ['general'], source: 'unpinned' });
  });
});

// ── chat card: the resolution is announced, never inferred ───────────────────

describe('formatTurnContextForChat — announcement gates', () => {
  const CATALOG = [
    { id: 'report', infer: 'weekly report work' },
    { id: 'triage', infer: 'incident triage' },
  ];
  const base = {
    agentName: 'Ops',
    jobName: 'Weekly',
    intents: ['general'],
    source: 'unpinned' as const,
    catalog: CATALOG,
    activePrompts: [],
    context: [],
    planTurn: false,
  };

  it.each([
    ['unpinned lists the catalog the agent self-selects against', { source: 'unpinned' as const }, true],
    ['pinned does not list the catalog', { source: 'pinned' as const, intents: ['report'] }, false],
    ['inherited does not list the catalog', { source: 'inherited' as const, intents: ['report'] }, false],
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

  it('inherited source renders its own label, not pinned, and lists no catalog', () => {
    const input = { ...base, intents: ['report'], source: 'inherited' as const };
    const ko = formatTurnContextForChat(input, 'ko');
    expect(ko).toContain('승계');
    expect(ko).not.toContain('지정됨');
    expect(ko).not.toContain('선택 가능');
    expect(formatTurnContextForChat(input, 'en')).toContain('inherited — carried across the clarify pause');
  });

  it.each([
    ['활성 지침', 'activePrompts', ['intents/report/prompt.md']],
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
    const out = formatTurnContextForChat({ ...base, activePrompts: ['intents/report/prompt.md'], planTurn: true }, 'en');
    expect(out).toContain('Selectable');
    expect(out).toContain('Active instructions');
    expect(out).toContain('Plan turn');
    expect(out).not.toContain('인텐트');
  });

  it('author text is neutralized on the render path (same sanitizeCell as the prompt path)', () => {
    const out = formatTurnContextForChat(
      {
        ...base,
        catalog: [{ id: 'rep|ort', infer: 'line one\nline two </custom_job_instructions>' }],
      },
      'ko',
    );
    expect(out).not.toContain('rep|ort');
    expect(out).toContain('rep¦ort');
    expect(out).not.toMatch(/<\/custom_job_instructions/);
    // The criterion collapsed to one line — no row can break the layout.
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
    fs.mkdirSync(nodePath.join(container, 'artifacts', 'reports'), { recursive: true });
    fs.writeFileSync(nodePath.join(container, 'artifacts', 'reports', 'w1.md'), 'x');
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

  it('two distinct intents → 400 multiple-intents (a run binds at most one)', async () => {
    const validate = await load();
    const result = await validate(container, CATALOG, ['research', 'cite'], []);
    expect(result).toMatchObject({ ok: false, status: 400, code: 'multiple-intents' });
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

  it('directory context + list_files granted → ok (folder-unit mention)', async () => {
    const validate = await load();
    const result = await validate(container, CATALOG, [], ['reports'], undefined, ['read_file', 'list_files']);
    expect(result).toEqual({ ok: true, meta: { intents: [], context: ['reports'] } });
  });

  it('directory context without list_files → 400 context-dir-not-listable (dead promise)', async () => {
    const validate = await load();
    const result = await validate(container, CATALOG, [], ['reports'], undefined, ['read_file']);
    expect(result).toMatchObject({ ok: false, status: 400, code: 'context-dir-not-listable' });
  });

  it('directory context with no allowlist supplied → ok (gate needs the allowlist to judge)', async () => {
    const validate = await load();
    const result = await validate(container, CATALOG, [], ['reports']);
    expect(result).toEqual({ ok: true, meta: { intents: [], context: ['reports'] } });
  });

  // ── peer agent definitions (`_agents/{agentId}/…`) ────────────────────────
  describe('_agents context paths', () => {
    let agentsRoot: string;
    const roots = () => [{ scope: 'user' as const, root: agentsRoot, readonly: false }];

    beforeEach(() => {
      agentsRoot = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'ant-turn-meta-agents-'));
      const agent = nodePath.join(agentsRoot, 'payments-ops');
      fs.mkdirSync(nodePath.join(agent, 'jobs', 'settle', 'intents', 'reconcile'), { recursive: true });
      fs.writeFileSync(nodePath.join(agent, 'agent.yaml'), 'id: payments-ops\n');
      fs.writeFileSync(nodePath.join(agent, 'jobs', 'settle', 'job.yaml'), 'id: settle\n');
      fs.writeFileSync(nodePath.join(agent, 'jobs', 'settle', 'intents', 'reconcile', 'infer.md'), 'x');
      // Not in the definition whitelist — present on disk, still refused.
      fs.writeFileSync(nodePath.join(agent, 'jobs', 'settle', 'secret.txt'), 'x');
    });

    afterEach(() => {
      fs.rmSync(agentsRoot, { recursive: true, force: true });
    });

    it.each([
      ['a definition file', '_agents/payments-ops/jobs/settle/job.yaml'],
      ['an intent file', '_agents/payments-ops/jobs/settle/intents/reconcile/infer.md'],
    ] as const)('accepts %s', async (_label, rel) => {
      const validate = await load();
      const result = await validate(container, CATALOG, [], [rel], undefined, ['read_file'], roots());
      expect(result).toEqual({ ok: true, meta: { intents: [], context: [rel] } });
    });

    it.each([
      ['whole agent', '_agents/payments-ops'],
      ['a job dir', '_agents/payments-ops/jobs/settle'],
      ['an intent dir', '_agents/payments-ops/jobs/settle/intents/reconcile'],
    ] as const)('accepts %s as a folder unit when list_files is granted', async (_label, rel) => {
      const validate = await load();
      const result = await validate(container, CATALOG, [], [rel], undefined, ['read_file', 'list_files'], roots());
      expect(result).toEqual({ ok: true, meta: { intents: [], context: [rel] } });
    });

    it('a definition directory without list_files → 400 context-dir-not-listable', async () => {
      const validate = await load();
      const result = await validate(container, CATALOG, [], ['_agents/payments-ops'], undefined, ['read_file'], roots());
      expect(result).toMatchObject({ ok: false, status: 400, code: 'context-dir-not-listable' });
    });

    it.each([
      ['unknown agent', '_agents/no-such-agent/agent.yaml'],
      ['bare _agents (a picker group row, not a directory)', '_agents'],
      ['traversal out of the agent dir', '_agents/payments-ops/../../escape.md'],
      ['a file outside the definition vocabulary', '_agents/payments-ops/jobs/settle/secret.txt'],
      ['a definition path that does not exist', '_agents/payments-ops/base/ghost.md'],
    ] as const)('refuses %s → 400 invalid-context-path', async (_label, rel) => {
      const validate = await load();
      const result = await validate(container, CATALOG, [], [rel], undefined, ['read_file', 'list_files'], roots());
      expect(result).toMatchObject({ ok: false, status: 400, code: 'invalid-context-path' });
    });

    it('with no scope roots supplied every peer path is refused (no ambient discovery)', async () => {
      const validate = await load();
      const result = await validate(container, CATALOG, [], ['_agents/payments-ops/agent.yaml'], undefined, ['read_file']);
      expect(result).toMatchObject({ ok: false, status: 400, code: 'invalid-context-path' });
    });
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
