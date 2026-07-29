/**
 * Thinking wire-shape contract — channel-split (broad-mining-minty + 3차 RCA).
 *
 * On adaptive models (Sonnet 5, Opus 5), omitting the `thinking` param does
 * NOT disable thinking — adaptive runs by default, server-side and billed.
 * The legacy `!enableThinking → {}` branch was a silent no-op "disable"
 * (broad-mining-minty: zero stream events → phantom idle-watchdog kills).
 * The API's REAL off-switch is an explicit `thinking:{type:'disabled'}`,
 * which is a legal shape on Sonnet 5 / Opus 5.
 *
 * Contract locked here:
 *  - STREAM channel (honorExplicitDisable=false): adaptive models send
 *    `thinking:{type:'adaptive', display:'summarized'}` on EVERY round —
 *    the round toggle is ignored so thinking_delta events keep the idle
 *    watchdog alive, and `disabled` (tool-call-as-text degeneration risk on
 *    Opus 5) never reaches tool-heavy graph rounds;
 *  - INVOKE channel (honorExplicitDisable=true): an EXPLICIT
 *    `enableThinking === false` sends `thinking:{type:'disabled'}` with NO
 *    `output_config` (Opus 5 rejects disabled × xhigh/max; the omitted-effort
 *    server default `high` is always valid). This is what stops small-cap aux
 *    calls (commit 2048 / breadcrumb 256 tokens) from burning the entire
 *    max_tokens on thinking and returning zero text (git-idempotent-tulip
 *    3차 RCA). `undefined` is NOT promoted to disable — unset callers keep
 *    always-on adaptive;
 *  - models registered `rejectsDisabledThinking: true` (Fable-class) keep
 *    adaptive even on the invoke channel;
 *  - `output_config.effort` stays PINNED to `high` whenever adaptive is sent —
 *    no thinkingBudget tiering, no `medium/xhigh/max`;
 *  - extended models (Haiku 4.5) keep the caller's toggle authoritative:
 *    `{}` when off/unset, `enabled + budget_tokens` when on;
 *  - non-Anthropic ids ('none' mode) never receive a thinking param.
 */

import { describe, it, expect } from 'vitest';
import { AnthropicLLMClient } from '../../src/periphery/adapters/llm/AnthropicLLMClient';

function thinkingParams(
  modelName: string,
  enableThinking: boolean | undefined,
  thinkingBudget: number,
  honorExplicitDisable: boolean,
): Record<string, any> {
  const client = new AnthropicLLMClient(undefined, { apiKey: 'test-key', modelName });
  return (client as any).buildThinkingParams(enableThinking, thinkingBudget, honorExplicitDisable);
}

const streamParams = (model: string, enable: boolean | undefined, budget = 10_000) =>
  thinkingParams(model, enable, budget, false);
const invokeParams = (model: string, enable: boolean | undefined, budget = 10_000) =>
  thinkingParams(model, enable, budget, true);

describe('buildThinkingParams — adaptive models, STREAM channel', () => {
  it('sends adaptive + summarized even when the caller disabled thinking (round 2+)', () => {
    const params = streamParams('claude-sonnet-5', false, 0);
    expect(params.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    // Effort is pinned, not omitted — `high` IS the server default, so the
    // previously-omitted disabled round is unchanged in cost.
    expect(params.output_config).toEqual({ effort: 'high' });
  });

  it('pins effort to high regardless of the round toggle or thinkingBudget', () => {
    for (const [enable, budget] of [[true, 10_000], [true, 2_000], [false, 0]] as const) {
      const params = streamParams('claude-sonnet-5', enable, budget);
      expect(params.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
      expect(params.output_config).toEqual({ effort: 'high' });
    }
  });

  it('never emits medium/xhigh/max effort on adaptive models', () => {
    for (const model of ['claude-sonnet-5', 'claude-opus-5']) {
      for (const [enable, budget] of [[true, 10_000], [true, 1_000], [false, 0]] as const) {
        const effort = streamParams(model, enable, budget).output_config?.effort;
        expect(effort).toBe('high');
      }
    }
  });

  it('never emits the legacy budget_tokens shape (400 on adaptive models)', () => {
    for (const enable of [true, false]) {
      const params = streamParams('claude-opus-5', enable, 10_000);
      expect(JSON.stringify(params)).not.toContain('budget_tokens');
      expect(params.thinking?.type).toBe('adaptive');
    }
  });

  it('never sends disabled on the stream channel, even for explicit false', () => {
    for (const model of ['claude-sonnet-5', 'claude-opus-5']) {
      expect(streamParams(model, false).thinking?.type).toBe('adaptive');
    }
  });
});

describe('buildThinkingParams — adaptive models, INVOKE channel', () => {
  it('honors an EXPLICIT enableThinking:false as thinking:{type:"disabled"}', () => {
    for (const model of ['claude-sonnet-5', 'claude-opus-5']) {
      const params = invokeParams(model, false, 0);
      expect(params.thinking).toEqual({ type: 'disabled' });
      // No output_config alongside disabled — Opus 5 rejects disabled at
      // xhigh/max; the omitted-effort server default (high) is always valid.
      expect(params.output_config).toBeUndefined();
    }
  });

  it('keeps always-on adaptive for true AND undefined (omission ≠ disable)', () => {
    for (const enable of [true, undefined]) {
      const params = invokeParams('claude-sonnet-5', enable);
      expect(params.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
      expect(params.output_config).toEqual({ effort: 'high' });
    }
  });

  it('keeps adaptive on rejectsDisabledThinking (Fable-class) models even for explicit false', async () => {
    const { MODEL_REGISTRY } = await import('@ant/shared');
    // Simulate a Fable-class registration without mutating the frozen registry
    // shape permanently — patch, assert, restore.
    const reg = MODEL_REGISTRY as Record<string, any>;
    reg['claude-fable-test'] = {
      id: 'claude-fable-test',
      displayName: 'Fable (test)',
      provider: 'anthropic',
      thinkingMode: 'adaptive',
      rejectsDisabledThinking: true,
    };
    try {
      const params = invokeParams('claude-fable-test', false, 0);
      expect(params.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
      expect(params.output_config).toEqual({ effort: 'high' });
    } finally {
      delete reg['claude-fable-test'];
    }
  });

  it('unknown claude-* ids default to disableable (visible 400 beats silent starvation)', () => {
    expect(invokeParams('claude-future-model', false, 0).thinking).toEqual({ type: 'disabled' });
  });
});

describe('buildThinkingParams — extended models (Haiku 4.5)', () => {
  it('keeps the round toggle authoritative: {} when disabled or unset', () => {
    for (const honor of [true, false]) {
      expect(thinkingParams('claude-haiku-4-5-20251001', false, 0, honor)).toEqual({});
      expect(thinkingParams('claude-haiku-4-5-20251001', undefined, 0, honor)).toEqual({});
    }
  });

  it('uses enabled + budget_tokens when enabled', () => {
    const params = invokeParams('claude-haiku-4-5-20251001', true, 8_000);
    expect(params.thinking).toEqual({ type: 'enabled', budget_tokens: 8_000 });
    expect(params.output_config).toBeUndefined();
  });
});

describe('buildThinkingParams — non-Anthropic ids (defensive)', () => {
  it("sends no thinking param for 'none'-mode ids", () => {
    for (const honor of [true, false]) {
      expect(thinkingParams('deepseek-v4-pro', true, 10_000, honor)).toEqual({});
      expect(thinkingParams('deepseek-v4-pro', false, 0, honor)).toEqual({});
    }
  });
});

describe('thinkingActive — invoke-path maxTokens floor discriminator', () => {
  const active = (params: Record<string, any>) =>
    (AnthropicLLMClient as any).thinkingActive(params);

  it('is false for disabled and for no thinking param at all', () => {
    expect(active({ thinking: { type: 'disabled' } })).toBe(false);
    expect(active({})).toBe(false);
  });

  it('is true for adaptive and legacy enabled shapes', () => {
    expect(active({ thinking: { type: 'adaptive', display: 'summarized' } })).toBe(true);
    expect(active({ thinking: { type: 'enabled', budget_tokens: 8_000 } })).toBe(true);
  });
});
