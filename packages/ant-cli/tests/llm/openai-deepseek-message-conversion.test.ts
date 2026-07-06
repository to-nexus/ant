/**
 * OpenAILLMClient — DeepSeek OpenAI-compatible message conversion guard.
 *
 * Locks M6 (the fatal DeepSeek constraint): `reasoning_content` must NEVER be
 * fed back into request messages, or DeepSeek returns 400 and the job dies
 * instantly. `convertToOpenAIMessages` strips every `thinking` block from
 * conversation history so no reasoning ever reaches the wire. This test fixes
 * that behavior against regression for BOTH history shapes:
 *   - assistant turn with thinking + text + tool_use  (tool-use branch)
 *   - assistant turn with thinking + text only         (plain branch)
 *
 * Also asserts the provider tag is honored (openai default vs injected deepseek).
 */

import { describe, it, expect } from 'vitest';
import { OpenAILLMClient } from '../../src/periphery/adapters/llm/OpenAILLMClient';
import type { MessageContentBlock } from '../../src/core/ports/llm';

const THINKING_SECRET = 'INTERNAL_REASONING_THAT_MUST_NOT_LEAK';

function makeClient(provider?: string): OpenAILLMClient {
  return new OpenAILLMClient(undefined, {
    apiKey: 'test-key',
    modelName: 'deepseek-v4-pro',
    provider,
  });
}

// convertToOpenAIMessages is private; access via cast for the unit assertion.
function convert(client: OpenAILLMClient, messages: any[]): any[] {
  return (client as any).convertToOpenAIMessages(messages);
}

describe('OpenAILLMClient DeepSeek message conversion (M6)', () => {
  it('strips thinking blocks from an assistant turn that also has tool_use', () => {
    const client = makeClient('deepseek');
    const history: Array<{ role: string; content: string | MessageContentBlock[] }> = [
      { role: 'user', content: 'do the thing' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: THINKING_SECRET, signature: 'sig' },
          { type: 'text', text: 'Reading the file now.' },
          { type: 'tool_use', id: 'call_1', name: 'read_file', input: { path: 'a.ts' } },
        ],
      },
    ];

    const out = convert(client, history);
    const serialized = JSON.stringify(out);

    expect(serialized).not.toContain('reasoning_content');
    expect(serialized).not.toContain(THINKING_SECRET);

    // Assistant turn keeps text + tool_calls, drops thinking.
    const assistant = out.find((m) => m.role === 'assistant');
    expect(assistant).toBeTruthy();
    expect(assistant.content).toBe('Reading the file now.');
    expect(assistant.tool_calls).toHaveLength(1);
    expect(assistant.tool_calls[0].function.name).toBe('read_file');
  });

  it('strips thinking blocks from an assistant turn with no tool_use', () => {
    const client = makeClient('deepseek');
    const history: Array<{ role: string; content: string | MessageContentBlock[] }> = [
      { role: 'user', content: 'question' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: THINKING_SECRET, signature: 'sig' },
          { type: 'text', text: 'Here is the answer.' },
        ],
      },
    ];

    const out = convert(client, history);
    const serialized = JSON.stringify(out);

    expect(serialized).not.toContain('reasoning_content');
    expect(serialized).not.toContain(THINKING_SECRET);

    const assistant = out.find((m) => m.role === 'assistant');
    expect(assistant.content).toBe('Here is the answer.');
  });

  it('defaults provider to openai, honors an injected deepseek tag', () => {
    expect(makeClient().provider).toBe('openai');
    expect(makeClient('deepseek').provider).toBe('deepseek');
  });
});
