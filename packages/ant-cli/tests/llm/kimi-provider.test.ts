/**
 * Kimi (Moonshot AI) provider wiring guard.
 *
 * Kimi is OpenAI-compatible, so it reuses OpenAILLMClient with an injected
 * baseURL/provider (LLMClientFactory), exactly like DeepSeek and GLM. This locks:
 *   - factory prefix detection (kimi-* → 'kimi')
 *   - the OpenAILLMClient provider tag round-trips as 'kimi'
 *   - the registry-derived pricing + context maps resolve (no strict-throw)
 *   - the data-consent gate covers Kimi
 *   - Kimi is deliberately NOT a thinking-toggle provider (no thinking param sent)
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

const KIMI_MODEL_IDS = ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.7-code-highspeed'] as const;

describe('Kimi provider wiring', () => {
  it('detects the kimi provider from the model-name prefix', () => {
    expect(detectProviderFromModel('kimi-k3')).toBe('kimi');
    expect(detectProviderFromModel('kimi-k2.7-code')).toBe('kimi');
    expect(detectProviderFromModel('KIMI-K3')).toBe('kimi'); // case-insensitive
  });

  it('round-trips the injected kimi provider tag on OpenAILLMClient', () => {
    const client = new OpenAILLMClient(undefined, {
      apiKey: 'test-key',
      modelName: 'kimi-k3',
      provider: 'kimi',
    });
    expect(client.provider).toBe('kimi');
    expect(client.modelName).toBe('kimi-k3');
  });

  it('registers all three models with provider kimi and selectable', () => {
    for (const id of KIMI_MODEL_IDS) {
      const spec = MODEL_REGISTRY[id];
      expect(spec).toBeTruthy();
      expect(spec.provider).toBe('kimi');
      expect(spec.selectable).toBe(true);
      // Non-Anthropic: must never carry Anthropic thinking params.
      expect(spec.thinkingMode).toBe('none');
    }
  });

  it('resolves registry-derived pricing without UnknownModelRateError', () => {
    // kimi-k3: 1M in @ $3 + 1M out @ $15 = $18
    expect(
      computeCallCostUsd('kimi-k3', {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      }),
    ).toBeCloseTo(18, 6);
    // kimi-k2.7-code: 1M in @ $0.95 + 1M out @ $4 = $4.95
    expect(
      computeCallCostUsd('kimi-k2.7-code', {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      }),
    ).toBeCloseTo(4.95, 6);
  });

  it('resolves registry-derived context windows (strict, no throw)', () => {
    expect(getModelContextWindow('kimi-k3')).toBe(1_048_576);
    expect(getModelContextWindow('kimi-k2.7-code')).toBe(262_144);
    expect(getModelContextWindow('kimi-k2.7-code-highspeed')).toBe(262_144);
  });

  it('gates Kimi behind the third-party data-consent notice', () => {
    expect(providerRequiresDataConsent('kimi')).toBe(true);
    expect(providerRequiresDataConsent('glm')).toBe(true);
    expect(providerRequiresDataConsent('deepseek')).toBe(true);
    expect(providerRequiresDataConsent('anthropic')).toBe(false);
    expect(providerRequiresDataConsent(undefined)).toBe(false);
  });
});

/**
 * Kimi is intentionally absent from THINKING_TOGGLE_PROVIDERS: Moonshot's exact
 * reasoning-param shape is unconfirmed, so the shared client must behave like
 * plain OpenAI and never attach a `thinking` param (which could 400 the request).
 */
describe('Kimi thinking param (deliberately not a toggle provider)', () => {
  afterEach(() => vi.restoreAllMocks());

  async function captureCreatePayload(options: Record<string, any>): Promise<any> {
    const client = new OpenAILLMClient(undefined, {
      apiKey: 'test-key',
      modelName: 'kimi-k3',
      provider: 'kimi',
    });
    const create = vi
      .fn()
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      .mockImplementation(async () => (async function* () {})());
    (client as any).client = { chat: { completions: { create } } };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of client.stream([{ role: 'user', content: 'hi' }] as any, options)) {
      /* drain */
    }
    expect(create).toHaveBeenCalledTimes(1);
    return create.mock.calls[0][0];
  }

  it('never attaches a thinking param regardless of enableThinking', async () => {
    expect((await captureCreatePayload({ enableThinking: true })).thinking).toBeUndefined();
    expect((await captureCreatePayload({ enableThinking: false })).thinking).toBeUndefined();
    expect((await captureCreatePayload({})).thinking).toBeUndefined();
  });
});
