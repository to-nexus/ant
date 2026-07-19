/**
 * Temperature SSOT — Anthropic sampling params are mode-aware.
 *
 * The per-call temperature from the LLM_TEMPERATURE policy table can only be
 * sent where the Anthropic API accepts it:
 *  - adaptive models (Sonnet 5, Opus 4.6+): the API removed the temperature
 *    parameter (400 if sent), and buildThinkingParams sends the adaptive
 *    thinking param on EVERY round anyway → NEVER send temperature;
 *  - extended models (Haiku 4.5): temperature must be 1/omitted while
 *    thinking is enabled → send only on non-thinking rounds;
 *  - undefined temperature → always omit (no accidental defaults).
 *
 * buildSamplingParams is a SIBLING of buildThinkingParams (whose contract is
 * locked by anthropic-thinking-params.test.ts) — the two must not be merged.
 */

import { describe, it, expect } from 'vitest';
import { AnthropicLLMClient } from '../../src/periphery/adapters/llm/AnthropicLLMClient';

function samplingParams(
  modelName: string,
  enableThinking: boolean,
  temperature: number | undefined,
): Record<string, any> {
  const client = new AnthropicLLMClient(undefined, { apiKey: 'test-key', modelName });
  return (client as any).buildSamplingParams(enableThinking, temperature);
}

describe('buildSamplingParams — adaptive models never receive temperature', () => {
  it.each(['claude-sonnet-5', 'claude-opus-4-8'])('%s: {} for thinking on AND off', (model) => {
    expect(samplingParams(model, true, 0.2)).toEqual({});
    expect(samplingParams(model, false, 0.2)).toEqual({});
  });
});

describe('buildSamplingParams — extended models (Haiku 4.5)', () => {
  it('omits temperature while thinking is enabled (API forces 1)', () => {
    expect(samplingParams('claude-haiku-4-5-20251001', true, 0.2)).toEqual({});
  });

  it('sends temperature on non-thinking rounds', () => {
    expect(samplingParams('claude-haiku-4-5-20251001', false, 0.2)).toEqual({ temperature: 0.2 });
  });
});

describe('buildSamplingParams — undefined temperature is always omitted', () => {
  it.each(['claude-sonnet-5', 'claude-haiku-4-5-20251001'])('%s', (model) => {
    expect(samplingParams(model, true, undefined)).toEqual({});
    expect(samplingParams(model, false, undefined)).toEqual({});
  });
});

describe('wire composition — request body', () => {
  function clientWithCapture(modelName: string) {
    const client = new AnthropicLLMClient(undefined, { apiKey: 'test-key', modelName });
    const captured: any[] = [];
    (client as any).client = {
      messages: {
        stream: (body: any) => {
          captured.push(body);
          return {
            finalMessage: async () => ({
              content: [{ type: 'text', text: 'ok' }],
              usage: { input_tokens: 1, output_tokens: 1 },
            }),
          };
        },
      },
    };
    return { client, captured };
  }

  it('adaptive model: body carries adaptive thinking and NO temperature key', async () => {
    const { client, captured } = clientWithCapture('claude-sonnet-5');
    await client.invokeWithUsage(
      [{ role: 'user', content: 'hi' }],
      { enableThinking: false, temperature: 0.2 },
    );
    expect(captured).toHaveLength(1);
    expect(captured[0].thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect('temperature' in captured[0]).toBe(false);
  });

  it('extended model, non-thinking round: body carries the temperature', async () => {
    const { client, captured } = clientWithCapture('claude-haiku-4-5-20251001');
    await client.invokeWithUsage(
      [{ role: 'user', content: 'hi' }],
      { enableThinking: false, temperature: 0.3 },
    );
    expect(captured[0].temperature).toBe(0.3);
    expect(captured[0].thinking).toBeUndefined();
  });

  it('extended model, thinking round: temperature omitted alongside enabled thinking', async () => {
    const { client, captured } = clientWithCapture('claude-haiku-4-5-20251001');
    await client.invokeWithUsage(
      [{ role: 'user', content: 'hi' }],
      { enableThinking: true, thinkingBudget: 5000, temperature: 0.3 },
    );
    expect(captured[0].thinking).toEqual({ type: 'enabled', budget_tokens: 5000 });
    expect('temperature' in captured[0]).toBe(false);
  });
});
