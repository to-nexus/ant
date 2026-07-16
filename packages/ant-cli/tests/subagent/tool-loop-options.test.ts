/**
 * callLLMWithToolLoop new options — silentChatCards, shouldAbort,
 * betweenRounds (drain), beforeFinalReturn (join + bounded extension),
 * roundsUsed/exhausted result fields. Existing-caller shape stays intact.
 */

import { describe, it, expect } from 'vitest';
import { callLLMWithToolLoop } from '../../src/agents/common/llm/callLLMWithToolLoop';
import type { MessageContentBlock } from '../../src/core/ports/llm';

type StreamEvent = Record<string, any>;

function scriptedLLM(rounds: StreamEvent[][], capture?: { messages: any[][] }): any {
  let call = 0;
  return {
    modelName: 'mock',
    async *stream(messages: any[]) {
      capture?.messages.push(messages);
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
const READ_TOOL = [{ name: 'read_file', description: 'r', input_schema: { type: 'object', properties: {} } }] as any;
const BASE = { temperature: 0, maxTokens: 100 };

describe('callLLMWithToolLoop options', () => {
  it('returns roundsUsed and exhausted=false on a clean finish', async () => {
    const llm = scriptedLLM([[toolUse('t1')], [text('final')]]);
    const res = await callLLMWithToolLoop(llm, [{ role: 'user', content: 'q' }], READ_TOOL,
      async () => 'result', { ...BASE, maxRounds: 5, silentChatCards: true });
    expect(res.response).toBe('final');
    expect(res.roundsUsed).toBe(2);
    expect(res.exhausted).toBe(false);
    expect(res.aborted).toBeUndefined();
  });

  it('shouldAbort ends the loop early with aborted=true', async () => {
    let calls = 0;
    const llm = scriptedLLM([[toolUse('t1')], [text('never reached')]]);
    const res = await callLLMWithToolLoop(llm, [{ role: 'user', content: 'q' }], READ_TOOL,
      async () => 'result',
      { ...BASE, maxRounds: 5, silentChatCards: true, shouldAbort: () => ++calls > 1 });
    expect(res.aborted).toBe(true);
  });

  it('betweenRounds blocks are appended to the tool-result user message', async () => {
    const capture = { messages: [] as any[][] };
    const llm = scriptedLLM([[toolUse('t1')], [text('final')]], capture);
    const drained: MessageContentBlock[] = [{ type: 'text', text: '[SUBAGENT REPORT abc] findings' } as any];
    await callLLMWithToolLoop(llm, [{ role: 'user', content: 'q' }], READ_TOOL,
      async () => 'result',
      { ...BASE, maxRounds: 5, silentChatCards: true, betweenRounds: async () => drained });

    const round2Messages = capture.messages[1];
    const lastUser = round2Messages[round2Messages.length - 1];
    const texts = (lastUser.content as any[]).filter((b) => b.type === 'text').map((b) => b.text);
    expect(texts.some((t: string) => t.includes('[SUBAGENT REPORT abc]'))).toBe(true);
  });

  it('beforeFinalReturn joins: response is withheld, blocks delivered, loop continues', async () => {
    const capture = { messages: [] as any[][] };
    const llm = scriptedLLM([[text('premature final')], [text('true final')]], capture);
    let joinCalls = 0;
    const res = await callLLMWithToolLoop(llm, [{ role: 'user', content: 'q' }], READ_TOOL,
      async () => 'result',
      {
        ...BASE, maxRounds: 3, silentChatCards: true,
        beforeFinalReturn: async () => {
          joinCalls++;
          return joinCalls === 1
            ? [{ type: 'text', text: '[SUBAGENT REPORT j1] late findings' } as any]
            : null;
        },
      });
    expect(res.response).toBe('true final');
    expect(joinCalls).toBe(2);
    // The withheld response + delivered blocks entered the transcript.
    const round2Messages = capture.messages[1];
    const assistant = round2Messages[round2Messages.length - 2];
    const user = round2Messages[round2Messages.length - 1];
    expect(JSON.stringify(assistant.content)).toContain('premature final');
    expect(JSON.stringify(user.content)).toContain('[SUBAGENT REPORT j1]');
  });

  it('join extension is bounded: at most +2 extra rounds', async () => {
    // LLM always produces a final text; join always returns blocks — without
    // the bound this would loop forever.
    const llm = scriptedLLM([[text('final')]]);
    let joinCalls = 0;
    const res = await callLLMWithToolLoop(llm, [{ role: 'user', content: 'q' }], READ_TOOL,
      async () => 'result',
      {
        ...BASE, maxRounds: 1, silentChatCards: true,
        beforeFinalReturn: async () => {
          joinCalls++;
          return [{ type: 'text', text: 'again' } as any];
        },
      });
    expect(res.response).toBe('final');
    expect(joinCalls).toBeLessThanOrEqual(3);
  });
});

describe('callLLMWithToolLoop — output-validity signals (final round)', () => {
  it('returns the final round stopReason (max_tokens truncation observable by callers)', async () => {
    const llm = scriptedLLM([
      [toolUse('t1')],
      [text('truncated fin'), { type: 'done', stopReason: 'max_tokens' }],
    ]);
    const res = await callLLMWithToolLoop(llm, [{ role: 'user', content: 'q' }], READ_TOOL,
      async () => 'result', { ...BASE, maxRounds: 5, silentChatCards: true });
    expect(res.response).toBe('truncated fin');
    expect(res.stopReason).toBe('max_tokens');
  });

  it('stopReason reflects the FINAL round, not an earlier round', async () => {
    const llm = scriptedLLM([
      [toolUse('t1'), { type: 'done', stopReason: 'tool_use' }],
      [text('clean final'), { type: 'done', stopReason: 'end_turn' }],
    ]);
    const res = await callLLMWithToolLoop(llm, [{ role: 'user', content: 'q' }], READ_TOOL,
      async () => 'result', { ...BASE, maxRounds: 5, silentChatCards: true });
    expect(res.stopReason).toBe('end_turn');
  });

  it('injects an explicit end-of-tools notice into the final (tool-stripped) round request', async () => {
    // Regression: tiny-counting-mocha — the last-round request silently lost
    // its tools and the model narrated exploration intent (degenerate
    // repetition) instead of producing its final artifact.
    const capture = { messages: [] as any[][] };
    const llm = scriptedLLM([[toolUse('t1')], [text('forced final')]], capture);
    const res = await callLLMWithToolLoop(llm, [{ role: 'user', content: 'q' }], READ_TOOL,
      async () => 'result', { ...BASE, maxRounds: 2, silentChatCards: true });
    expect(res.exhausted).toBe(true);

    const finalRoundMessages = capture.messages[1];
    const lastUser = finalRoundMessages[finalRoundMessages.length - 1];
    const texts = (lastUser.content as any[]).filter((b: any) => b.type === 'text').map((b: any) => b.text);
    expect(texts.some((t: string) => t.includes('Tool access has ended'))).toBe(true);
    // The old lie ("1 tool call remaining") must be gone — the final round has
    // zero tools; the nudge and the notice must both be truthful.
    expect(texts.some((t: string) => t.includes('1 tool call remaining'))).toBe(false);
  });
});
