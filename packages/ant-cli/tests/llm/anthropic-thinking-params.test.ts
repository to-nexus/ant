/**
 * `broad-mining-minty` regression — adaptive thinking must be REAL on every round.
 *
 * On adaptive models (Sonnet 5, Opus 5), omitting the `thinking` param does
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
 *  - `output_config.effort` is PINNED to `high` on every adaptive round —
 *    no thinkingBudget tiering, no per-round omission. `high` is the server
 *    default, so this is cost-neutral against the previously-omitted rounds
 *    while removing the `medium` tier that could silently skip thinking.
 *    `xhigh`/`max` are deliberately unused (per-round spend);
 *  - extended models (Haiku 4.5) keep the caller's toggle authoritative:
 *    `{}` when off, `enabled + budget_tokens` when on — thinkingBudget stays
 *    load-bearing there and only there;
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
    // Effort is pinned, not omitted — `high` IS the server default, so the
    // previously-omitted disabled round is unchanged in cost.
    expect(params.output_config).toEqual({ effort: 'high' });
  });

  it('pins effort to high regardless of the round toggle or thinkingBudget', () => {
    for (const [enable, budget] of [[true, 10_000], [true, 2_000], [false, 0]] as const) {
      const params = thinkingParams('claude-sonnet-5', enable, budget);
      expect(params.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
      expect(params.output_config).toEqual({ effort: 'high' });
    }
  });

  it('never emits medium/xhigh/max effort on adaptive models', () => {
    for (const model of ['claude-sonnet-5', 'claude-opus-5']) {
      for (const [enable, budget] of [[true, 10_000], [true, 1_000], [false, 0]] as const) {
        const effort = thinkingParams(model, enable, budget).output_config?.effort;
        expect(effort).toBe('high');
      }
    }
  });

  it('never emits the legacy budget_tokens shape (400 on adaptive models)', () => {
    for (const enable of [true, false]) {
      const params = thinkingParams('claude-opus-5', enable, 10_000);
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
