import { describe, it, expect, vi, beforeAll } from 'vitest';
import { callLLMWithToolLoop } from '../../src/agents/common/llm/callLLMWithToolLoop';
import type { LLMClient, LLMStreamEvent } from '../../src/core/ports/llm';

/**
 * Per-round thinking-toggle contract (empty-calming-alder follow-up).
 *
 * The multi-round tool loop must send thinking ONLY on round 0 (initial
 * planning) and OFF on every tool-continuation round — the code-execute /
 * 5e981a1f contract. On adaptive Anthropic models the toggle is ignored
 * (always thinks); this bounds toggle providers (GLM/DeepSeek unbounded)
 * whose every-round reasoning overflows max_tokens. Before the fix the loop
 * forwarded the caller's static value on every round.
 */

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const textEvent = (text: string): LLMStreamEvent => ({ type: 'text', text });
const toolUseEvent = (id: string, name: string, input: Record<string, any>): LLMStreamEvent => ({
  type: 'tool_use',
  toolUse: { id, name, input },
});

/** Stub LLM that records the options passed to `stream` on each round. */
function makeCapturingLLM(rounds: LLMStreamEvent[][]) {
  const calls: Array<{ enableThinking?: boolean; thinkingBudget?: number }> = [];
  let roundIdx = 0;
  const llm = {
    provider: 'stub',
    modelName: 'stub',
    invoke: async () => '',
    async *stream(_messages: any, options?: any) {
      calls.push({ enableThinking: options?.enableThinking, thinkingBudget: options?.thinkingBudget });
      const events = rounds[roundIdx] ?? [];
      roundIdx++;
      for (const e of events) yield e;
    },
  } as unknown as LLMClient;
  return { llm, calls };
}

const NOOP_TOOL = { name: 'noop', description: 'noop', input_schema: { type: 'object', properties: {}, required: [] } };

describe('callLLMWithToolLoop — per-round thinking toggle', () => {
  it('sends thinking only on round 0; OFF on tool-continuation rounds', async () => {
    // Round 0: reasons + calls a tool. Round 1: final answer, no tools.
    const { llm, calls } = makeCapturingLLM([
      [textEvent('reason'), toolUseEvent('t1', 'noop', {})],
      [textEvent('final')],
    ]);

    const result = await callLLMWithToolLoop(
      llm,
      [{ role: 'user', content: 'go' }],
      [NOOP_TOOL],
      async () => 'tool-result',
      { temperature: 0, maxTokens: 1000, enableThinking: true, thinkingBudget: 10000 },
    );

    expect(result.response).toBe('final');
    expect(calls).toHaveLength(2);
    // Round 0 honors the caller's value + budget.
    expect(calls[0].enableThinking).toBe(true);
    expect(calls[0].thinkingBudget).toBe(10000);
    // Round 1 (after the tool call) forces thinking OFF and drops the budget.
    expect(calls[1].enableThinking).toBe(false);
    expect(calls[1].thinkingBudget).toBeUndefined();
  });

  it('round 0 honors enableThinking:false too (caller opt-out preserved)', async () => {
    const { llm, calls } = makeCapturingLLM([
      [toolUseEvent('t1', 'noop', {})],
      [textEvent('done')],
    ]);

    await callLLMWithToolLoop(
      llm,
      [{ role: 'user', content: 'go' }],
      [NOOP_TOOL],
      async () => 'r',
      { temperature: 0, maxTokens: 1000, enableThinking: false, thinkingBudget: 10000 },
    );

    expect(calls[0].enableThinking).toBe(false);
    expect(calls[0].thinkingBudget).toBeUndefined();
    expect(calls[1].enableThinking).toBe(false);
  });
});
