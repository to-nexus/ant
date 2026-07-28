/**
 * Parsed-event backstop window contract (sandy-loading-coral 2nd RCA).
 *
 * The idle window is a runaway BACKSTOP, not a liveness judge — transport
 * timers (llmDispatcher.ts headers/body + TCP keepalive) own liveness, since
 * both SDKs swallow provider keepalives (Anthropic `ping`, SSE `:` comments)
 * before the event iterator. History of regime-gated guesses: 90s killed
 * legitimate adaptive silence (prime-nesting-grate, 8 retries re-billing
 * ~150K cached tokens each) and legitimate GLM >90s TTFT (sandy-loading-coral,
 * 8/8 identical kills). The contract locked here: one generous uniform window,
 * strictly above the transport bodyTimeout (300s), for BOTH clients and every
 * thinking regime.
 */

import { describe, it, expect } from 'vitest';
import { AnthropicLLMClient } from '../../src/periphery/adapters/llm/AnthropicLLMClient';
import { OpenAILLMClient } from '../../src/periphery/adapters/llm/OpenAILLMClient';

const BACKSTOP_MS = 600_000;
const TRANSPORT_BODY_TIMEOUT_MS = 300_000;

function anthropicIdle(modelName: string, enableThinking: boolean, thinkingBudget: number): number {
  const client = new AnthropicLLMClient(undefined, { apiKey: 'test-key', modelName });
  return (client as any).resolveIdleTimeoutMs(enableThinking, thinkingBudget);
}

function openaiIdle(enableThinking?: boolean): number {
  const client = new OpenAILLMClient(undefined, {
    apiKey: 'test-key',
    modelName: 'glm-5.2',
    provider: 'glm',
  });
  return (client as any).resolveStreamIdleMs(enableThinking);
}

describe('parsed-event backstop — uniform, regime-blind, above transport bodyTimeout', () => {
  it('Anthropic: adaptive / extended / thinking-off all get the same backstop', () => {
    expect(anthropicIdle('claude-sonnet-5', false, 0)).toBe(BACKSTOP_MS);
    expect(anthropicIdle('claude-sonnet-5', true, 10_000)).toBe(BACKSTOP_MS);
    expect(anthropicIdle('claude-haiku-4-5-20251001', false, 0)).toBe(BACKSTOP_MS);
    expect(anthropicIdle('claude-haiku-4-5-20251001', true, 10_000)).toBe(BACKSTOP_MS);
  });

  it('OpenAI-compat (GLM): thinking-on and thinking-off get the same backstop — the 90s TTFT kill-loop is gone', () => {
    expect(openaiIdle(false)).toBe(BACKSTOP_MS);
    expect(openaiIdle(true)).toBe(BACKSTOP_MS);
    expect(openaiIdle(undefined)).toBe(BACKSTOP_MS);
  });

  it('backstop sits strictly above the transport bodyTimeout so transport fires first on byte-silence', () => {
    expect(BACKSTOP_MS).toBeGreaterThan(TRANSPORT_BODY_TIMEOUT_MS);
  });
});
