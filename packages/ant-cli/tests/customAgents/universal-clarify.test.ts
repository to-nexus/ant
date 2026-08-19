/**
 * Universal clarify tool — the blocking-question contract axis:
 *   advertisement (knob × budget), the sole-call gate, args validation,
 *   end-and-resume seams (dangling tool_use detect / close), routing, and
 *   the I2-compatible seal shape. Schema/gate truth tables — no prompt or
 *   description prose pinning.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  CLARIFY_TOOL_NAME,
  CLARIFY_TOOL_DEFINITION,
  clarifyBlockFromArgs,
} from '../../src/agents/common/clarify/tool';
import {
  findDanglingClarifyToolUse,
  buildClarifyToolResultTurn,
} from '../../src/agents/common/clarify/toolResume';
import { UNIVERSAL_CLARIFY_BUDGET } from '../../src/core/customAgents/universalToolPolicy';
import {
  activateCustomJob,
  _resetActiveCustomJobForTests,
} from '../../src/core/customAgents/activeCustomJob';
import type { ResolvedCustomJob } from '../../src/core/customAgents/types';
import type { CustomIntentDef } from '@ant/shared';
import { buildAdvertisedTools } from '../../src/agents/universal/graph/nodes/agent';
import { universalToolNodeConfig, isClarifyAllowedNow, routeAfterTool } from '../../src/agents/universal/graph/nodes/tool';
import { respondNode } from '../../src/agents/universal/graph/nodes/respond';
import { parseSealedTurnContext } from '../../src/agents/universal/graph/state';
import { _resetUniversalRuntimeForTests } from '../../src/agents/universal/graph/runtime';
import { CONV_KEYS } from '../../src/agents/common/graph/conversations';

function makeResolved(overrides?: Partial<Pick<ResolvedCustomJob, 'clarifyDefault' | 'intents' | 'builtinTools'>>): ResolvedCustomJob {
  return {
    agentId: 'ops',
    jobId: 'weekly',
    scope: 'user',
    agentName: 'Ops',
    jobName: 'Weekly',
    prose: 'p',
    intents: overrides?.intents ?? [],
    intentPrompts: {},
    mcpServers: {},
    builtinTools: overrides?.builtinTools ?? ['read_file'],
    approval: {},
    clarifyDefault: overrides?.clarifyDefault ?? true,
    agentDir: '/tmp/x',
    jobDir: '/tmp/x/jobs/weekly',
  };
}

const intent = (id: string, clarify?: boolean): CustomIntentDef => ({
  id,
  description: `intent ${id}`,
  ...(clarify !== undefined ? { clarify } : {}),
});

beforeEach(() => {
  _resetUniversalRuntimeForTests();
});

afterEach(() => {
  _resetActiveCustomJobForTests();
  vi.restoreAllMocks();
});

// ── tool definition + args validation ────────────────────────────────────────

describe('CLARIFY_TOOL_DEFINITION — schema shape', () => {
  it('is named "clarify" with question required and options/allowFreeText optional', () => {
    expect(CLARIFY_TOOL_DEFINITION.name).toBe(CLARIFY_TOOL_NAME);
    expect(CLARIFY_TOOL_DEFINITION.input_schema.required).toEqual(['question']);
    expect(Object.keys(CLARIFY_TOOL_DEFINITION.input_schema.properties).sort()).toEqual(
      ['allowFreeText', 'options', 'question'],
    );
  });
});

describe('clarifyBlockFromArgs — validation table', () => {
  it.each([
    // [label, args, ok]
    ['question only', { question: 'Which window?' }, true],
    ['question + options', { question: 'Which?', options: ['7d', '30d'] }, true],
    ['question + allowFreeText false', { question: 'Which?', allowFreeText: false }, true],
    ['missing question', {}, false],
    ['empty question', { question: '   ' }, false],
    ['non-string question', { question: 42 }, false],
    ['non-array options', { question: 'q', options: 'a,b' }, false],
    ['non-string option entries', { question: 'q', options: [1, 2] }, false],
    ['non-boolean allowFreeText', { question: 'q', allowFreeText: 'yes' }, false],
  ] as const)('%s', (_label, args, ok) => {
    const result = clarifyBlockFromArgs(args as Record<string, unknown>);
    expect(typeof result === 'string').toBe(!ok);
  });

  it('defaults allowFreeText to true and drops empty option entries', () => {
    const block = clarifyBlockFromArgs({ question: ' q ', options: [' 7d ', '  '] });
    expect(block).toEqual({ question: 'q', options: ['7d'], allowFreeText: true });
  });
});

// ── advertisement (knob × budget → ABSENCE from the tool list) ───────────────

describe('buildAdvertisedTools — clarify rides only on includeClarify', () => {
  it('appends the clarify definition when included, omits it otherwise', () => {
    const resolved = makeResolved();
    const withClarify = buildAdvertisedTools(resolved, { includeClarify: true });
    const without = buildAdvertisedTools(resolved, { includeClarify: false });
    const bare = buildAdvertisedTools(resolved);
    expect(withClarify.map((t) => t.name)).toContain(CLARIFY_TOOL_NAME);
    expect(without.map((t) => t.name)).not.toContain(CLARIFY_TOOL_NAME);
    expect(bare.map((t) => t.name)).not.toContain(CLARIFY_TOOL_NAME);
  });
});

describe('isClarifyAllowedNow — knob × budget table', () => {
  it.each([
    // [label, clarifyDefault, intents, activeIntents, roundsUsed, expected]
    ['enabled, budget fresh', true, [], undefined, 0, true],
    ['enabled, budget partly spent', true, [], undefined, UNIVERSAL_CLARIFY_BUDGET - 1, true],
    ['enabled, budget exhausted', true, [], undefined, UNIVERSAL_CLARIFY_BUDGET, false],
    ['knob off (definition default)', false, [], undefined, 0, false],
    ['active intent disables', true, [intent('a', false)], ['a'], 0, false],
    ['active intent enables over default false', false, [intent('a', true)], ['a'], 0, true],
    ['no turnContext → general → default', false, [intent('a', true)], undefined, 0, false],
  ] as const)('%s', (_label, clarifyDefault, intents, activeIntents, roundsUsed, expected) => {
    activateCustomJob(makeResolved({ clarifyDefault, intents: [...intents] }));
    const state = {
      clarifyRoundsUsed: roundsUsed,
      ...(activeIntents
        ? { turnContext: { intents: [...activeIntents], context: [], planTurn: false, source: 'explicit' as const } }
        : {}),
    } as any;
    expect(isClarifyAllowedNow(state)).toBe(expected);
  });
});

// ── gateCall — instructive rejections (never execution) ─────────────────────

describe('gateCall — clarify branch table', () => {
  const call = (args: Record<string, unknown> = { question: 'q' }) => ({
    id: 'tu_1',
    name: CLARIFY_TOOL_NAME,
    args,
  });

  it('unavailable (knob off) → rejection telling the model to proceed with defaults', () => {
    activateCustomJob(makeResolved({ clarifyDefault: false }));
    const result = universalToolNodeConfig.gateCall!({ clarifyRoundsUsed: 0 } as any, call());
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.error).toMatch(/not available/);
  });

  it('budget spent → same unavailable rejection', () => {
    activateCustomJob(makeResolved());
    const result = universalToolNodeConfig.gateCall!({ clarifyRoundsUsed: UNIVERSAL_CLARIFY_BUDGET } as any, call());
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.error).toMatch(/not available/);
  });

  it('invalid args → args rejection (uniform error for the wrapper fall-through)', () => {
    activateCustomJob(makeResolved());
    const result = universalToolNodeConfig.gateCall!({ clarifyRoundsUsed: 0 } as any, call({}));
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.error).toMatch(/Invalid clarify call/);
  });

  it('allowed + valid but reaching the gate (mixed round) → sole-call rejection', () => {
    activateCustomJob(makeResolved());
    const result = universalToolNodeConfig.gateCall!({ clarifyRoundsUsed: 0 } as any, call());
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.error).toMatch(/ONLY tool call/);
  });

  it('other calls in the round are ungated by clarify (read_file in the allowlist still executes)', () => {
    activateCustomJob(makeResolved());
    const result = universalToolNodeConfig.gateCall!(
      { clarifyRoundsUsed: 0 } as any,
      { id: 'tu_2', name: 'read_file', args: { path: 'a.md' } },
    );
    expect(result.allowed).toBe(true);
  });
});

// ── end-and-resume seams ─────────────────────────────────────────────────────

describe('findDanglingClarifyToolUse — structural detection table', () => {
  const clarifyUse = { type: 'tool_use', id: 'tu_9', name: 'clarify', input: { question: 'Which window?' } };

  it.each([
    ['empty history', [], null],
    ['tail is a user turn', [{ role: 'user', content: 'hi' }], null],
    ['tail assistant with string content', [{ role: 'assistant', content: 'text' }], null],
    ['tail assistant ending in a text block', [{ role: 'assistant', content: [{ type: 'text', text: 'x' }] }], null],
    ['tail assistant ending in a NON-clarify tool_use', [{ role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'read_file', input: {} }] }], null],
    ['closed clarify (tool_result follows)', [
      { role: 'assistant', content: [clarifyUse] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_9', content: 'ans' }] },
    ], null],
    ['dangling clarify at the tail', [
      { role: 'user', content: 'start' },
      { role: 'assistant', content: [{ type: 'text', text: 'lead-in' }, clarifyUse] },
    ], { toolUseId: 'tu_9', question: 'Which window?' }],
  ] as const)('%s', (_label, history, expected) => {
    expect(findDanglingClarifyToolUse(history as any)).toEqual(expected);
  });

  it('tool_use without an id is not a valid dangling target', () => {
    const history = [{ role: 'assistant', content: [{ type: 'tool_use', name: 'clarify', input: { question: 'q' } }] }];
    expect(findDanglingClarifyToolUse(history as any)).toBeNull();
  });
});

describe('buildClarifyToolResultTurn', () => {
  it('closes the given id with the user text under the single framing', () => {
    const turn = buildClarifyToolResultTurn('tu_9', '7d please');
    expect(turn.role).toBe('user');
    expect(turn.content).toHaveLength(1);
    expect(turn.content[0].type).toBe('tool_result');
    expect(turn.content[0].tool_use_id).toBe('tu_9');
    expect(turn.content[0].content).toBe('User replied:\n7d please');
  });
});

// ── routing + seal ───────────────────────────────────────────────────────────

describe('routeAfterTool — pure predicate', () => {
  it('routes respond on a clarify pause, agent otherwise', () => {
    expect(routeAfterTool({ _clarifyPause: { toolUseId: 'tu_1', question: 'q' } } as any)).toBe('respond');
    expect(routeAfterTool({} as any)).toBe('agent');
  });
});

describe('respond seal — I2-compatible clarify markers', () => {
  function makeState(
    clarifyPause: { toolUseId: string; question: string } | undefined,
    updateArtifacts: any,
    turnContext?: { intents: string[]; context: string[]; planTurn: boolean; source: string },
  ) {
    return {
      projectId: 'proj',
      language: 'en',
      streamingCompleted: true,
      response: 'done',
      _turnToolWrites: [],
      conversations: { [CONV_KEYS.SESSION_MAIN]: [{ role: 'user', content: 'hi' }] },
      clarifyRoundsUsed: 1,
      _clarifyPause: clarifyPause,
      turnContext,
      deps: { session: { updateArtifacts } },
    } as any;
  }

  it('paused seal carries boolean awaitingClarify + separate id/question fields', async () => {
    activateCustomJob(makeResolved());
    const updateArtifacts = vi.fn(async (..._args: any[]) => undefined);
    await respondNode(makeState({ toolUseId: 'tu_9', question: 'Which window?' }, updateArtifacts));
    expect(updateArtifacts).toHaveBeenCalledTimes(1);
    const sealed = updateArtifacts.mock.calls[0][3].state;
    expect(sealed.awaitingClarify).toBe(true); // strict boolean — I2 checks === true
    expect(sealed.clarifyToolUseId).toBe('tu_9');
    expect(sealed.clarifyQuestion).toBe('Which window?');
    expect(sealed.clarifyRoundsUsed).toBe(1);
  });

  it('non-paused seal omits awaitingClarify/id/question (stale markers self-clear) but keeps rounds', async () => {
    activateCustomJob(makeResolved());
    const updateArtifacts = vi.fn(async (..._args: any[]) => undefined);
    await respondNode(makeState(undefined, updateArtifacts));
    const sealed = updateArtifacts.mock.calls[0][3].state;
    expect('awaitingClarify' in sealed).toBe(false);
    expect('clarifyToolUseId' in sealed).toBe(false);
    expect('clarifyQuestion' in sealed).toBe(false);
    expect(sealed.clarifyRoundsUsed).toBe(1);
  });

  it('paused seal carries the RESOLVED turn context (clarify continuity)', async () => {
    activateCustomJob(makeResolved());
    const updateArtifacts = vi.fn(async (..._args: any[]) => undefined);
    const tc = { intents: ['writing'], context: ['plan/notes.md'], planTurn: true, source: 'pinned' };
    await respondNode(makeState({ toolUseId: 'tu_9', question: 'q' }, updateArtifacts, tc));
    expect(updateArtifacts.mock.calls[0][3].state.clarifyTurnContext).toEqual(tc);
  });

  it('non-paused seal omits clarifyTurnContext (stale continuity self-clears)', async () => {
    activateCustomJob(makeResolved());
    const updateArtifacts = vi.fn(async (..._args: any[]) => undefined);
    const tc = { intents: ['writing'], context: [], planTurn: false, source: 'pinned' };
    await respondNode(makeState(undefined, updateArtifacts, tc));
    expect('clarifyTurnContext' in updateArtifacts.mock.calls[0][3].state).toBe(false);
  });
});

// ── restore sanitation (runner-side inheritance input) ──────────────────────

describe('parseSealedTurnContext — restore sanitation table', () => {
  it.each([
    ['full pinned seal round-trips (source dropped)',
      { intents: ['writing'], context: ['a.md'], planTurn: true, source: 'pinned' },
      { intents: ['writing'], context: ['a.md'], planTurn: true }],
    ['contentless general seal inherits nothing',
      { intents: ['general'], context: [], planTurn: false, source: 'unpinned' },
      undefined],
    ['general intents but planTurn true → context/plan inherit, intents reset',
      { intents: ['general'], context: [], planTurn: true, source: 'default' },
      { intents: [], context: [], planTurn: true }],
    ['missing seal → undefined', undefined, undefined],
    ['malformed (string) → undefined', 'nope', undefined],
    ['non-string entries filtered, non-boolean planTurn coerced false',
      { intents: ['a', 7], context: [null, 'b.md'], planTurn: 'yes' },
      { intents: ['a'], context: ['b.md'], planTurn: false }],
  ] as const)('%s', (_label, raw, expected) => {
    expect(parseSealedTurnContext(raw as any)).toEqual(expected);
  });
});
