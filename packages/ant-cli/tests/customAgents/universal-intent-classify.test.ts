/**
 * Universal intent classification axis — the `<intents>` tag parser table,
 * the classify node's skip ladder (explicit → empty catalog → empty resume →
 * infer with fallback), and the accept-time explicit-intent validation.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as nodePath from 'path';
import { parseIntentsTag } from '../../src/agents/universal/graph/nodes/classify/parser';
import { classifyNode } from '../../src/agents/universal/graph/nodes/classify';
import {
  activateCustomJob,
  _resetActiveCustomJobForTests,
} from '../../src/core/customAgents/activeCustomJob';
import type { ResolvedCustomJob } from '../../src/core/customAgents/types';
import type { UniversalGraphState } from '../../src/agents/universal/graph/state';
import { CONV_KEYS } from '../../src/agents/common/graph/conversations';

const CATALOG = new Set(['research', 'cite']);

describe('parseIntentsTag — table', () => {
  it.each([
    ['single id', '<intents>research</intents>', ['research']],
    ['multiple ids', '<intents>research, cite</intents>', ['research', 'cite']],
    ['whitespace tolerated', '<intents>  research ,  cite  </intents>', ['research', 'cite']],
    ['unknown dropped, valid kept', '<intents>research, ghost</intents>', ['research']],
    ['general + concrete → concrete only', '<intents>general, research</intents>', ['research']],
    ['dedupe', '<intents>research, research</intents>', ['research']],
    ['general alone survives', '<intents>general</intents>', ['general']],
    ['surrounding prose tolerated', 'thinking...\n<intents>cite</intents>\ndone', ['cite']],
  ] as const)('%s', (_label, raw, expected) => {
    expect(parseIntentsTag(raw, CATALOG)).toEqual(expected);
  });

  it.each([
    ['missing tag', 'no tag at all'],
    ['all unknown', '<intents>ghost, phantom</intents>'],
    ['empty tag', '<intents>  </intents>'],
  ] as const)('%s → null (caller retries then falls back)', (_label, raw) => {
    expect(parseIntentsTag(raw, CATALOG)).toBeNull();
  });
});

// ── classify node skip ladder ────────────────────────────────────────────────

function makeResolved(intents: ResolvedCustomJob['intents']): ResolvedCustomJob {
  return {
    agentId: 'ops',
    jobId: 'weekly',
    scope: 'user',
    agentName: 'Ops',
    jobName: 'Weekly',
    description: 'desc',
    prose: 'p',
    injectionsToc: [],
    intents,
    mcpServers: {},
    builtinTools: [],
    approval: {},
    workspace: 'none',
    models: {},
    plan: 'suggested',
    outputs: { mode: 'free' },
    agentDir: '/tmp/x',
    jobDir: '/tmp/x/jobs/weekly',
  };
}

function makeState(overrides: Partial<UniversalGraphState>, llmRaw?: string | Error): {
  state: UniversalGraphState;
  invocations: () => number;
} {
  let calls = 0;
  const llm = {
    invokeWithUsage: vi.fn(async () => {
      calls++;
      if (llmRaw instanceof Error) throw llmRaw;
      return { content: llmRaw ?? '', usage: undefined };
    }),
  };
  const promptBuilder = {
    build: vi.fn(async () => ({ system: 'sys', user: 'user', sections: {} })),
  };
  const state = {
    userMessage: 'do research on pens',
    language: 'en',
    conversations: { [CONV_KEYS.SESSION_MAIN]: [{ role: 'user', content: 'do research on pens' }] },
    toolCalls: [],
    pendingToolCalls: [],
    _turnToolWrites: [],
    activeIntents: ['general'],
    deps: { llm, promptBuilder },
    ...overrides,
  } as unknown as UniversalGraphState;
  return { state, invocations: () => calls };
}

afterEach(() => {
  _resetActiveCustomJobForTests();
});

describe('classifyNode — skip ladder', () => {
  it('1. explicit intents adopted, zero LLM calls', async () => {
    activateCustomJob(makeResolved([{ id: 'research', description: 'r' }]));
    const { state, invocations } = makeState({ explicitIntents: ['research', 'cite'] });
    const result = await classifyNode(state);
    expect(result.activeIntents).toEqual(['research', 'cite']);
    expect(invocations()).toBe(0);
  });

  it('2. empty catalog → [general], zero LLM calls', async () => {
    activateCustomJob(makeResolved([]));
    const { state, invocations } = makeState({});
    const result = await classifyNode(state);
    expect(result.activeIntents).toEqual(['general']);
    expect(invocations()).toBe(0);
  });

  it('3. empty userMessage (resume) → keeps the restored classification', async () => {
    activateCustomJob(makeResolved([{ id: 'research', description: 'r' }]));
    const { state, invocations } = makeState({ userMessage: '', activeIntents: ['research'] });
    const result = await classifyNode(state);
    expect(result.activeIntents).toEqual(['research']);
    expect(invocations()).toBe(0);
  });

  it('4. inference adopts the parsed multi-label result', async () => {
    activateCustomJob(makeResolved([
      { id: 'research', description: 'r' },
      { id: 'cite', description: 'c' },
    ]));
    const { state, invocations } = makeState({}, '<intents>research, cite</intents>');
    const result = await classifyNode(state);
    expect(result.activeIntents).toEqual(['research', 'cite']);
    expect(invocations()).toBe(1);
  });

  it('4b. unparsable output retries once, then falls back to [general] (never throws)', async () => {
    activateCustomJob(makeResolved([{ id: 'research', description: 'r' }]));
    const { state, invocations } = makeState({}, 'no tag here');
    const result = await classifyNode(state);
    expect(result.activeIntents).toEqual(['general']);
    expect(invocations()).toBe(2);
  });

  it('4c. LLM error falls back to [general] (classification must not kill the turn)', async () => {
    activateCustomJob(makeResolved([{ id: 'research', description: 'r' }]));
    const { state } = makeState({}, new Error('boom'));
    const result = await classifyNode(state);
    expect(result.activeIntents).toEqual(['general']);
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
