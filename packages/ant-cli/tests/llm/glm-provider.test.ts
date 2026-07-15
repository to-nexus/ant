/**
 * GLM (Zhipu / Z.ai) provider wiring guard.
 *
 * GLM is OpenAI-compatible, so it reuses OpenAILLMClient with an injected
 * baseURL/provider (LLMClientFactory), exactly like DeepSeek. This locks:
 *   - factory prefix detection (glm-* → 'glm')
 *   - the OpenAILLMClient provider tag round-trips as 'glm'
 *   - the registry-derived pricing + context maps resolve (no strict-throw)
 *   - the data-consent gate covers GLM
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  computeCallCostUsd,
  getModelContextWindow,
  providerRequiresDataConsent,
  MODEL_REGISTRY,
} from '@ant/shared';
import { detectProviderFromModel } from '../../src/periphery/adapters/llm/LLMClientFactory';
import { OpenAILLMClient } from '../../src/periphery/adapters/llm/OpenAILLMClient';

describe('GLM provider wiring', () => {
  it('detects the glm provider from the model-name prefix', () => {
    expect(detectProviderFromModel('glm-5.2')).toBe('glm');
    expect(detectProviderFromModel('glm-4.7')).toBe('glm');
    expect(detectProviderFromModel('GLM-5.2')).toBe('glm'); // case-insensitive
  });

  it('round-trips the injected glm provider tag on OpenAILLMClient', () => {
    const client = new OpenAILLMClient(undefined, {
      apiKey: 'test-key',
      modelName: 'glm-5.2',
      provider: 'glm',
    });
    expect(client.provider).toBe('glm');
    expect(client.modelName).toBe('glm-5.2');
  });

  it('registers both tiers with provider glm and selectable', () => {
    for (const id of ['glm-5.2', 'glm-4.7'] as const) {
      const spec = MODEL_REGISTRY[id];
      expect(spec).toBeTruthy();
      expect(spec.provider).toBe('glm');
      expect(spec.selectable).toBe(true);
      // Non-Anthropic: must never carry Anthropic thinking params.
      expect(spec.thinkingMode).toBe('none');
    }
  });

  it('resolves registry-derived pricing without UnknownModelRateError', () => {
    const cost = computeCallCostUsd('glm-5.2', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    // 1M in @ $1.4 + 1M out @ $4.4 = $5.8
    expect(cost).toBeCloseTo(5.8, 6);
  });

  it('resolves registry-derived context windows (strict, no throw)', () => {
    expect(getModelContextWindow('glm-5.2')).toBe(1_000_000);
    expect(getModelContextWindow('glm-4.7')).toBe(200_000);
  });

  it('gates GLM behind the third-party data-consent notice', () => {
    expect(providerRequiresDataConsent('glm')).toBe(true);
    expect(providerRequiresDataConsent('deepseek')).toBe(true);
    expect(providerRequiresDataConsent('anthropic')).toBe(false);
    expect(providerRequiresDataConsent(undefined)).toBe(false);
  });
});

/**
 * Per-round thinking-toggle parity (empty-calming-alder RCA).
 *
 * The tool-loop passes `enableThinking` per round (ON round 1 / OFF after tool
 * calls). AnthropicLLMClient honors it; OpenAILLMClient must honor it for
 * hard-toggle providers (GLM / DeepSeek) too — else GLM reasons on every
 * action round, ballooning output into the max_tokens ceiling. Precedence:
 * the provider *_THINKING=disabled env is an operator hard opt-out that wins.
 */
describe('OpenAI-compat thinking toggle (parity with AnthropicLLMClient)', () => {
  const ORIGINAL_GLM_THINKING = process.env.GLM_THINKING;

  afterEach(() => {
    if (ORIGINAL_GLM_THINKING === undefined) delete process.env.GLM_THINKING;
    else process.env.GLM_THINKING = ORIGINAL_GLM_THINKING;
    vi.restoreAllMocks();
  });

  /** Drive `stream(...)` and return the payload passed to chat.completions.create. */
  async function captureCreatePayload(
    provider: string,
    options: Record<string, any>,
  ): Promise<any> {
    const client = new OpenAILLMClient(undefined, {
      apiKey: 'test-key',
      modelName: provider === 'openai' ? 'gpt-4o' : `${provider}-5.2`,
      provider,
    });
    const create = vi
      .fn()
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      .mockImplementation(async () => (async function* () {})());
    // Reach the injected OpenAI SDK instance on the private field.
    (client as any).client = { chat: { completions: { create } } };

    const messages = [{ role: 'user', content: 'hi' }];
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of client.stream(messages as any, options)) {
      /* drain */
    }
    expect(create).toHaveBeenCalledTimes(1);
    return create.mock.calls[0][0];
  }

  it('GLM: enableThinking=false → thinking.type=disabled', async () => {
    delete process.env.GLM_THINKING;
    const payload = await captureCreatePayload('glm', { enableThinking: false });
    expect(payload.thinking).toEqual({ type: 'disabled' });
  });

  it('GLM: enableThinking=true (or omitted) → thinking.type=enabled', async () => {
    delete process.env.GLM_THINKING;
    const enabled = await captureCreatePayload('glm', { enableThinking: true });
    expect(enabled.thinking).toEqual({ type: 'enabled' });
    const omitted = await captureCreatePayload('glm', {});
    expect(omitted.thinking).toEqual({ type: 'enabled' });
  });

  it('GLM: GLM_THINKING=disabled env wins over the per-round toggle', async () => {
    process.env.GLM_THINKING = 'disabled';
    const payload = await captureCreatePayload('glm', { enableThinking: true });
    expect(payload.thinking).toEqual({ type: 'disabled' });
  });

  it('DeepSeek: honors the per-round toggle (THINKING_TOGGLE_PROVIDERS generalization)', async () => {
    const payload = await captureCreatePayload('deepseek', { enableThinking: false });
    expect(payload.thinking).toEqual({ type: 'disabled' });
  });

  it('real OpenAI: never attaches a thinking param (would 400)', async () => {
    const payload = await captureCreatePayload('openai', { enableThinking: false });
    expect(payload.thinking).toBeUndefined();
  });
});
