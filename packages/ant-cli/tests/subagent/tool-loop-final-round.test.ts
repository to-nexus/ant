/**
 * callLLMWithToolLoop — final-round toolChoice contract + in-stream
 * degeneration breaker (sage-causing-rover RCA).
 *
 * Old contract: the last round DELETED the tool declarations (`tools:
 * undefined`) while the history carried tool_calls — the GLM degeneration
 * trigger. New contract: tools stay declared on EVERY round;
 * `toolChoice: 'none'` carries the prohibition on the final round.
 */

import { describe, it, expect } from 'vitest';
import { callLLMWithToolLoop } from '../../src/agents/common/llm/callLLMWithToolLoop';

type StreamEvent = Record<string, any>;

function scriptedLLM(
  rounds: StreamEvent[][],
  capture?: { options: any[] },
): any {
  let call = 0;
  return {
    modelName: 'mock',
    async *stream(_messages: any[], options: any) {
      capture?.options.push(options);
      const batch = rounds[Math.min(call, rounds.length - 1)];
      call++;
      for (const ev of batch) yield ev;
    },
  };
}

const text = (t: string): StreamEvent => ({ type: 'text', text: t });
const toolUse = (id: string): StreamEvent => ({
  type: 'tool_use',
  toolUse: { id, name: 'read_file', input: { path: 'x.ts' } },
});
const READ_TOOL = [
  { name: 'read_file', description: 'r', input_schema: { type: 'object', properties: {} } },
] as any;
const BASE = { temperature: 0, maxTokens: 100, silentChatCards: true };

describe('final-round toolChoice contract', () => {
  it("keeps tools DECLARED on the final round and passes toolChoice:'none'", async () => {
    const capture = { options: [] as any[] };
    const llm = scriptedLLM([[toolUse('t1')], [text('final')]], capture);
    await callLLMWithToolLoop(llm, [{ role: 'user', content: 'q' }], READ_TOOL,
      async () => 'result', { ...BASE, maxRounds: 2 });

    expect(capture.options).toHaveLength(2);
    // Round 1 (normal): tools declared, auto.
    expect(capture.options[0].tools).toHaveLength(1);
    expect(capture.options[0].toolChoice).toBe('auto');
    // Round 2 (final): tools STILL declared — the constraint, not deletion,
    // carries the prohibition.
    expect(capture.options[1].tools).toHaveLength(1);
    expect(capture.options[1].toolChoice).toBe('none');
  });

  it('passes no toolChoice at all when the caller supplied no tools', async () => {
    const capture = { options: [] as any[] };
    const llm = scriptedLLM([[text('answer')]], capture);
    await callLLMWithToolLoop(llm, [{ role: 'user', content: 'q' }], [] as any,
      async () => 'result', { ...BASE, maxRounds: 1 });
    expect(capture.options[0].tools).toBeUndefined();
    expect(capture.options[0].toolChoice).toBeUndefined();
  });

  it('tool calls on the final round despite the constraint → exhausted partial (provider-noncompliance path)', async () => {
    // Previously unreachable-by-construction; now depends on provider
    // compliance with tool_choice — lock the graceful degrade.
    const llm = scriptedLLM([[toolUse('t1')], [text('partial'), toolUse('t2')]]);
    const res = await callLLMWithToolLoop(llm, [{ role: 'user', content: 'q' }], READ_TOOL,
      async () => 'result', { ...BASE, maxRounds: 2 });
    expect(res.exhausted).toBe(true);
    expect(res.response).toBe('partial');
    expect(res.degenerate).toBeUndefined();
  });
});

describe('in-stream degeneration breaker', () => {
  const LOOP = 'Let me read the update method that animates the ringFragments. ';

  it('severs a degenerate round early and returns degenerate=true + finalMessages', async () => {
    const events: StreamEvent[] = [];
    for (let i = 0; i < 200; i++) events.push(text(LOOP));
    events.push({ type: 'done', stopReason: 'max_tokens' });
    const llm = scriptedLLM([events]);

    const res = await callLLMWithToolLoop(llm, [{ role: 'user', content: 'q' }], READ_TOOL,
      async () => 'result', { ...BASE, maxRounds: 3 });

    expect(res.degenerate).toBe(true);
    expect(res.finalMessages).toBeDefined();
    // Severed well before the full 200 repetitions were consumed.
    expect(res.response.length).toBeLessThan(LOOP.length * 20);
    // The degenerate turn is NOT in finalMessages (history stays clean for a
    // corrective re-ask; an unsigned thinking block or garbage text in a
    // continued conversation would 400 / skew later rounds).
    const serialized = JSON.stringify(res.finalMessages);
    expect(serialized).not.toContain(LOOP.trim());
  });

  it('does not trip on distinct prose across many rounds', async () => {
    const round1: StreamEvent[] = [];
    for (let i = 0; i < 60; i++) {
      round1.push(text(`Observation ${i}: module m${i} wires layer ${i % 4} via src/f${i}.ts. `));
    }
    const llm = scriptedLLM([round1]);
    const res = await callLLMWithToolLoop(llm, [{ role: 'user', content: 'q' }], READ_TOOL,
      async () => 'result', { ...BASE, maxRounds: 2 });
    expect(res.degenerate).toBeUndefined();
    expect(res.response).toContain('Observation 59');
  });

  it('provider retry event resets the repetition counter', async () => {
    // 3 near-trip repetitions, then a transport retry, then clean output —
    // the pre-retry units must not count against the replayed attempt.
    const events: StreamEvent[] = [
      text(LOOP), text(LOOP), text(LOOP),
      { type: 'retry' },
      text('Fresh clean answer after the provider retry, all distinct now. '),
    ];
    const llm = scriptedLLM([events]);
    const res = await callLLMWithToolLoop(llm, [{ role: 'user', content: 'q' }], READ_TOOL,
      async () => 'result', { ...BASE, maxRounds: 1 });
    expect(res.degenerate).toBeUndefined();
    expect(res.response).toContain('Fresh clean answer');
  });
});
