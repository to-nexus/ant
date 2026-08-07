/**
 * Universal inline compaction — the agent node's message assembly must run
 * the session history through compactRun (compactTurns + TurnPruner) with a
 * model-window-keyed budget, and always end on a user message.
 */

import { describe, it, expect } from 'vitest';
import { composeUniversalMessages } from '../../src/agents/universal/graph/nodes/agent';
import { CONV_KEYS } from '../../src/agents/common/graph/conversations';
import type { UniversalGraphState } from '../../src/agents/universal/graph/state';

function makeState(history: Array<{ role: 'user' | 'assistant'; content: string }>): UniversalGraphState {
  return {
    userMessage: 'latest',
    language: 'en',
    conversations: { [CONV_KEYS.SESSION_MAIN]: history },
    toolCalls: [],
    pendingToolCalls: [],
    _turnToolWrites: [],
    // Haiku 4.5 exposes the smallest registered window (200k) — deterministic
    // small budget so the fixture history is decisively over it.
    deps: { llm: { modelName: 'claude-haiku-4-5-20251001' } },
  } as unknown as UniversalGraphState;
}

function approxTokens(messages: Array<{ content: unknown }>): number {
  return Math.ceil(messages.map((m) => JSON.stringify(m.content)).join('').length / 2.8);
}

describe('composeUniversalMessages', () => {
  it('compacts an over-budget history down to the conversation budget', () => {
    // ~60 turns × 20k chars ≈ 430k tokens — far over any window budget.
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (let i = 0; i < 30; i++) {
      history.push({ role: 'user', content: `turn ${i} ` + 'q'.repeat(20_000) });
      history.push({ role: 'assistant', content: `answer ${i} ` + 'a'.repeat(20_000) });
    }
    history.push({ role: 'user', content: 'the final question' });

    const before = approxTokens(history);
    const messages = composeUniversalMessages(makeState(history));
    const after = approxTokens(messages);

    expect(after).toBeLessThan(before);
    // Budget ceiling: history budget can never exceed window*0.7; generous
    // slack for summary blocks and estimation error.
    expect(after).toBeLessThan(160_000);
    // The hot tail survives — the newest user turn is still present.
    const flat = JSON.stringify(messages);
    expect(flat).toContain('the final question');
  });

  it('small history passes through untouched', () => {
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'do the thing' },
    ];
    const messages = composeUniversalMessages(makeState(history));
    expect(messages).toHaveLength(3);
    expect(messages[2].content).toBe('do the thing');
  });

  it('guarantees a trailing user message', () => {
    const messages = composeUniversalMessages(
      makeState([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'unfinished' },
      ]),
    );
    expect(messages[messages.length - 1].role).toBe('user');
  });

  it('empty history yields a lone continuation user message', () => {
    const messages = composeUniversalMessages(makeState([]));
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
  });
});
