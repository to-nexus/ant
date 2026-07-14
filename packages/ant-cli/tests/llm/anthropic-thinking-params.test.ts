/**
 * `broad-mining-minty` regression — adaptive thinking must be REAL on every round.
 *
 * On adaptive models (Sonnet 5, Opus 4.x), omitting the `thinking` param does
 * NOT disable thinking — adaptive runs by default, server-side and billed.
 * The legacy `!enableThinking → {}` branch was a silent no-op "disable", and
 * because `display` defaults to `"omitted"` the model reasoned for minutes
 * with zero stream events, tripping the 300s idle watchdog as a phantom
 * "network stall" (all 8 retries died the same way; task starved 38+ min).
 *
 * Contract locked here:
 *  - adaptive models send `thinking:{type:'adaptive', display:'summarized'}`
 *    on EVERY round (round toggle ignored) so thinking_delta events flow and
 *    keep the idle watchdog alive;
 *  - `output_config.effort` only accompanies enabled-thinking calls (budget
 *    tiering preserved); disabled rounds omit it (server default == the
 *    previous omitted-param behavior → cost-neutral);
 *  - extended models (Haiku 4.5) keep the caller's toggle authoritative:
 *    `{}` when off, `enabled + budget_tokens` when on;
 *  - non-Anthropic ids ('none' mode) never receive a thinking param.
 */

import { describe, it, expect } from 'vitest';
import { AnthropicLLMClient } from '../../src/periphery/adapters/llm/AnthropicLLMClient';

function thinkingParams(modelName: string, enableThinking: boolean, thinkingBudget: number): Record<string, any> {
  const client = new AnthropicLLMClient(undefined, { apiKey: 'test-key', modelName });
  return (client as any).buildThinkingParams(enableThinking, thinkingBudget);
}

describe('buildThinkingParams — adaptive models (Sonnet 5)', () => {
  it('sends adaptive + summarized even when the caller disabled thinking (round 2+)', () => {
    const params = thinkingParams('claude-sonnet-5', false, 0);
    expect(params.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    // Cost-neutral: no effort override on disabled rounds (server default).
    expect(params.output_config).toBeUndefined();
  });

  it('sends adaptive + summarized + high effort for large-budget thinking calls', () => {
    const params = thinkingParams('claude-sonnet-5', true, 10_000);
    expect(params.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(params.output_config).toEqual({ effort: 'high' });
  });

  it('maps small budgets to medium effort', () => {
    const params = thinkingParams('claude-sonnet-5', true, 2_000);
    expect(params.output_config).toEqual({ effort: 'medium' });
  });

  it('never emits the legacy budget_tokens shape (400 on adaptive models)', () => {
    for (const enable of [true, false]) {
      const params = thinkingParams('claude-opus-4-8', enable, 10_000);
      expect(JSON.stringify(params)).not.toContain('budget_tokens');
      expect(params.thinking?.type).toBe('adaptive');
    }
  });
});

describe('buildThinkingParams — extended models (Haiku 4.5)', () => {
  it('keeps the round toggle authoritative: {} when disabled', () => {
    expect(thinkingParams('claude-haiku-4-5-20251001', false, 0)).toEqual({});
  });

  it('uses enabled + budget_tokens when enabled', () => {
    const params = thinkingParams('claude-haiku-4-5-20251001', true, 8_000);
    expect(params.thinking).toEqual({ type: 'enabled', budget_tokens: 8_000 });
    expect(params.output_config).toBeUndefined();
  });
});

describe('buildThinkingParams — non-Anthropic ids (defensive)', () => {
  it("sends no thinking param for 'none'-mode ids", () => {
    expect(thinkingParams('deepseek-v4-pro', true, 10_000)).toEqual({});
    expect(thinkingParams('deepseek-v4-pro', false, 0)).toEqual({});
  });
});
