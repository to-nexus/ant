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

import { describe, it, expect } from 'vitest';
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
