/**
 * `prime-nesting-grate` regression — stream idle watchdog vs adaptive models.
 *
 * Adaptive-thinking models (Sonnet 5) decide server-side whether to think:
 * even a request with `enableThinking=false` can sit silent well past 90s
 * between `message_start` and the first delta. The old
 * `resolveIdleTimeoutMs` returned 90s for ALL non-thinking calls, so plan
 * tool-loop rounds 2+ on sonnet-5 tripped the watchdog, burned all 8 stream
 * retries (re-billing ~150K cached tokens each), and permanently failed the
 * task. The adaptive window (300s) must apply regardless of the request's
 * thinking flag; 90s stays for non-adaptive models only.
 */

import { describe, it, expect } from 'vitest';
import { AnthropicLLMClient } from '../../src/periphery/adapters/llm/AnthropicLLMClient';

function idleTimeout(modelName: string, enableThinking: boolean, thinkingBudget: number): number {
  const client = new AnthropicLLMClient(undefined, { apiKey: 'test-key', modelName });
  return (client as any).resolveIdleTimeoutMs(enableThinking, thinkingBudget);
}

describe('resolveIdleTimeoutMs — adaptive-model floor', () => {
  it('adaptive model keeps the 300s window even with enableThinking=false', () => {
    expect(idleTimeout('claude-sonnet-5', false, 0)).toBeGreaterThanOrEqual(300_000);
  });

  it('adaptive model with thinking and a large budget stays at 300s', () => {
    expect(idleTimeout('claude-sonnet-5', true, 10_000)).toBe(300_000);
  });

  it('non-adaptive model keeps the tight 90s non-thinking window', () => {
    expect(idleTimeout('claude-haiku-4-5-20251001', false, 0)).toBe(90_000);
  });
});
