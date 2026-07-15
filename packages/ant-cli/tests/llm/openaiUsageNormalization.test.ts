/**
 * normalizeOpenAICompatUsage — disjoint-contract guard for OpenAI-compatible
 * providers (OpenAI / DeepSeek / GLM).
 *
 * These providers report `prompt_tokens` INCLUDING the cached subset
 * (`prompt_tokens_details.cached_tokens`). The rate card + tokenUtils assume the
 * Anthropic disjoint contract where `inputTokens` is cache-MISS only. This test
 * locks the subtraction so cached tokens are never billed twice (the GLM/DeepSeek
 * ~3x over-charge regression: `empty-calming-alder`).
 */

import { describe, it, expect } from 'vitest';
import { normalizeOpenAICompatUsage } from '../../src/periphery/adapters/llm/OpenAILLMClient';

describe('normalizeOpenAICompatUsage', () => {
  it('subtracts cached tokens from prompt_tokens so inputTokens is cache-miss only', () => {
    // Real warm-call shape from the empty-calming-alder GLM forensics.
    const usage = normalizeOpenAICompatUsage({
      prompt_tokens: 69479,
      completion_tokens: 6803,
      total_tokens: 76282,
      prompt_tokens_details: { cached_tokens: 68032 },
    });
    expect(usage).toEqual({
      inputTokens: 1447, // 69479 - 68032, NOT 69479
      outputTokens: 6803,
      totalTokens: 76282,
      cacheReadTokens: 68032,
    });
  });

  it('keeps input and cacheRead disjoint (no double count) — sum equals prompt_tokens', () => {
    const usage = normalizeOpenAICompatUsage({
      prompt_tokens: 80690,
      completion_tokens: 146,
      total_tokens: 80836,
      prompt_tokens_details: { cached_tokens: 78720 },
    })!;
    expect(usage.inputTokens + (usage.cacheReadTokens ?? 0)).toBe(80690);
  });

  it('cold call (no cache) leaves inputTokens = prompt_tokens and omits cacheReadTokens', () => {
    const usage = normalizeOpenAICompatUsage({
      prompt_tokens: 68049,
      completion_tokens: 1000,
      total_tokens: 69049,
      prompt_tokens_details: { cached_tokens: 0 },
    });
    expect(usage).toEqual({
      inputTokens: 68049,
      outputTokens: 1000,
      totalTokens: 69049,
    });
    expect(usage!.cacheReadTokens).toBeUndefined();
  });

  it('handles missing prompt_tokens_details (real OpenAI without caching)', () => {
    const usage = normalizeOpenAICompatUsage({
      prompt_tokens: 500,
      completion_tokens: 120,
      total_tokens: 620,
    });
    expect(usage).toEqual({ inputTokens: 500, outputTokens: 120, totalTokens: 620 });
  });

  it('never goes negative if cached exceeds prompt (defensive)', () => {
    const usage = normalizeOpenAICompatUsage({
      prompt_tokens: 100,
      completion_tokens: 10,
      total_tokens: 110,
      prompt_tokens_details: { cached_tokens: 150 },
    })!;
    expect(usage.inputTokens).toBe(0);
    expect(usage.cacheReadTokens).toBe(150);
  });

  it('returns undefined when usage is absent', () => {
    expect(normalizeOpenAICompatUsage(undefined)).toBeUndefined();
    expect(normalizeOpenAICompatUsage(null)).toBeUndefined();
  });
});
