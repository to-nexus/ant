/**
 * Temperature SSOT — OpenAI-compat invokeStructured drops the 0.7 literal.
 *
 * invoke/stream already honored per-call temperature; invokeStructured was
 * the one path with a hardcoded `temperature: 0.7`. Contract:
 *   - per-call `options.temperature` wins;
 *   - constructor temperature is the fallback (not a literal).
 */

import { describe, it, expect } from 'vitest';
import { OpenAILLMClient } from '../../src/periphery/adapters/llm/OpenAILLMClient';

function clientWithCapture(constructorTemp: number) {
  const client = new OpenAILLMClient(undefined, {
    apiKey: 'test-key',
    modelName: 'glm-5.2',
    provider: 'glm',
    temperature: constructorTemp,
  });
  const captured: any[] = [];
  (client as any).client = {
    chat: {
      completions: {
        create: async (req: any) => {
          captured.push(req);
          return {
            choices: [{ message: { content: '{"ok":true}' } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          };
        },
      },
    },
  };
  return { client, captured };
}

describe('OpenAILLMClient — invokeStructured temperature', () => {
  it('per-call value wins', async () => {
    const { client, captured } = clientWithCapture(0.4);
    await client.invokeStructured([{ role: 'user', content: 'hi' }], { type: 'object' }, 'S', { temperature: 0.2 });
    expect(captured[0].temperature).toBe(0.2);
  });

  it('constructor value is the fallback — never a 0.7 literal', async () => {
    const { client, captured } = clientWithCapture(0.4);
    await client.invokeStructured([{ role: 'user', content: 'hi' }], { type: 'object' }, 'S');
    expect(captured[0].temperature).toBe(0.4);
  });
});
