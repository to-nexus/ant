/**
 * Universal turn-context axis — the resolve strategy's deterministic
 * `turnContext` assembly (single writer; no LLM), the `planDocs` disk
 * listing (plan-consumption gate's deterministic half), and the accept-time
 * explicit turn-meta validation.
 *
 * The former detect node (LLM intent/tier classification) was removed:
 * universal has nothing for a classifier to route, so every field below is
 * a pure function of runner inputs + disk.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as nodePath from 'path';
import { universalResolveStrategy } from '../../src/agents/universal/graph/nodes/resolve';
import {
  activateCustomJob,
  _resetActiveCustomJobForTests,
} from '../../src/core/customAgents/activeCustomJob';
import type { ResolvedCustomJob } from '../../src/core/customAgents/types';
import type { UniversalGraphState } from '../../src/agents/universal/graph/state';

const CATALOG = new Set(['research', 'cite']);

function makeResolved(): ResolvedCustomJob {
  return {
    agentId: 'ops',
    jobId: 'weekly',
    scope: 'user',
    agentName: 'Ops',
    jobName: 'Weekly',
    prose: 'p',
    injectionsToc: [],
    intents: [],
    mcpServers: {},
    builtinTools: [],
    approval: {},
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
    ['explicit intents adopted verbatim', { explicitIntents: ['research', 'cite'] }, { intents: ['research', 'cite'], source: 'explicit' }],
    ['no explicit input → [general] / infer', {}, { intents: ['general'], source: 'infer' }],
    ['@ctx alone flips source to explicit', { explicitContext: ['plan/notes.md'] }, { intents: ['general'], context: ['plan/notes.md'], source: 'explicit' }],
    ['@plan rides as planTurn', { planRequested: true }, { planTurn: true }],
    ['planRequested absent → planTurn false', {}, { planTurn: false }],
  ] as const)('%s', async (_label, overrides, expected) => {
    const result = await universalResolveStrategy.loadArtifacts(makeState(overrides as any));
    expect(result.turnContext).toMatchObject(expected);
  });

  it('onResume assembles the same deterministic context (no restore channel needed)', async () => {
    const result = await universalResolveStrategy.onResume!(makeState({ userMessage: '' }));
    expect(result.turnContext).toMatchObject({ intents: ['general'], source: 'infer', planTurn: false });
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
