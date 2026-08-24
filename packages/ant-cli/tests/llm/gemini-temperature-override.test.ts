/**
 * Temperature SSOT — Gemini honors per-call temperature.
 *
 * Before this fix the adapter sent the CONSTRUCTOR temperature (env default
 * 0.7) on every call and silently ignored `options.temperature`, so policy
 * values passed by nodes (e.g. DECOMPOSE 0.2 via callLLMWithToolLoop) never
 * reached the wire on Gemini-routed jobs (visual). Contract:
 *   - per-call `options.temperature` wins when provided;
 *   - constructor value remains the fallback when omitted.
 */

import { describe, it, expect } from 'vitest';
import { GeminiLLMClient } from '../../src/periphery/adapters/llm/GeminiLLMClient';

function clientWithCapture() {
  const client = new GeminiLLMClient(undefined, {
    apiKey: 'test-key',
    modelName: 'gemini-2.5-pro',
    temperature: 0.7,
  });
  const captured: any[] = [];
  (client as any).client = {
    models: {
      generateContent: async (req: any) => {
        captured.push(req);
        return { text: '{"ok":true}', usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } };
      },
      generateContentStream: async (req: any) => {
        captured.push(req);
        async function* gen() { yield { text: 'ok' }; }
        return gen();
      },
    },
  };
  return { client, captured };
}

describe('GeminiLLMClient — per-call temperature override', () => {
  it('invokeWithUsage: per-call value wins', async () => {
    const { client, captured } = clientWithCapture();
    await client.invokeWithUsage([{ role: 'user', content: 'hi' }], { temperature: 0.2 });
    expect(captured[0].config.temperature).toBe(0.2);
  });

  it('invokeWithUsage: constructor fallback when omitted', async () => {
    const { client, captured } = clientWithCapture();
    await client.invokeWithUsage([{ role: 'user', content: 'hi' }], {});
    expect(captured[0].config.temperature).toBe(0.7);
  });

  it('stream: per-call value wins', async () => {
    const { client, captured } = clientWithCapture();
    for await (const _e of client.stream([{ role: 'user', content: 'hi' }], { temperature: 0.3 })) {
      // drain
    }
    expect(captured[0].config.temperature).toBe(0.3);
  });
});
