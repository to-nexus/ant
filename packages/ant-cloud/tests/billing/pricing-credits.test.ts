/**
 * Billing math SSOT — per-model cost + credit conversion.
 *
 * Locks the two invariants the whole billing slice rests on:
 *   1. Cost is per-model (Opus ≠ Sonnet ≠ Haiku) and weights output + cache
 *      at their real rates — NOT the legacy model-agnostic billable-input.
 *   2. Credits = list cost × markup, in integer micro-credits.
 */

import { describe, it, expect } from 'vitest';
import {
  MODEL_RATE_CARD,
  computeCallCostUsd,
  computeCallCostUsdSafe,
  computeJobCostUsd,
  computeModelCostBreakdownUsd,
  UnknownModelRateError,
  usdToMicroCredits,
  microCreditsToCredits,
  creditsToMicroCredits,
  normalizeTier,
  compareTiers,
} from '@ant/shared';
import { MARKUP_DEFAULT, CREDIT_PACKAGES, getCreditPackage } from '../../src/infrastructure/billing/catalog';

describe('pricing — per-model cost', () => {
  it('prices 1M input on Opus at exactly $5.00', () => {
    expect(computeCallCostUsd('claude-opus-4-8', { inputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(5, 6);
  });

  it('weights output at the model rate (Opus output = $25/MTok)', () => {
    expect(computeCallCostUsd('claude-opus-4-8', { inputTokens: 0, outputTokens: 1_000_000 })).toBeCloseTo(25, 6);
  });

  it('prices cache read ~0.1x input and cache write ~1.25x (Sonnet)', () => {
    const read = computeCallCostUsd('claude-sonnet-4-6', { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 });
    const write = computeCallCostUsd('claude-sonnet-4-6', { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 1_000_000 });
    expect(read).toBeCloseTo(0.3, 6); // 0.1x of $3
    expect(write).toBeCloseTo(3.75, 6); // 1.25x of $3
  });

  it('throws on an unknown model id (no silent fallback)', () => {
    expect(() => computeCallCostUsd('gpt-9-ultra', { inputTokens: 1, outputTokens: 1 })).toThrow(UnknownModelRateError);
  });

  it('safe variant prices unknown models at the most-expensive rate + flags them', () => {
    const r = computeCallCostUsdSafe('gpt-9-ultra', { inputTokens: 1_000_000, outputTokens: 0 });
    expect(r.unknownModelId).toBe('gpt-9-ultra');
    expect(r.usd).toBeCloseTo(MODEL_RATE_CARD['claude-opus-4-8'].input, 6); // Opus fallback
  });

  it('aggregates a mixed-model job at each model own rate', () => {
    const byModel = {
      'claude-opus-4-8': { inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000 },
      'claude-sonnet-4-6': { inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000 },
    };
    const { usd, unknownModelIds } = computeJobCostUsd(byModel as any);
    expect(usd).toBeCloseTo(5 + 3, 6); // Opus $5 + Sonnet $3
    expect(unknownModelIds).toEqual([]);
    const breakdown = computeModelCostBreakdownUsd(byModel as any);
    expect(breakdown['claude-opus-4-8']).toBeCloseTo(5, 6);
    expect(breakdown['claude-sonnet-4-6']).toBeCloseTo(3, 6);
  });
});

describe('credits — markup + conversion', () => {
  it('converts $1 list cost to (markup × 100) credits', () => {
    const micro = usdToMicroCredits(1, MARKUP_DEFAULT);
    // 1 credit = $0.01 list; markup inflates consumption. $1 × 1.75 / 0.01 = 175 credits.
    expect(microCreditsToCredits(micro)).toBeCloseTo(100 * MARKUP_DEFAULT, 6);
  });

  it('never returns negative micro-credits for non-positive cost', () => {
    expect(usdToMicroCredits(0)).toBe(0);
    expect(usdToMicroCredits(-5)).toBe(0);
  });

  it('round-trips credits → micro → credits', () => {
    expect(microCreditsToCredits(creditsToMicroCredits(2_000))).toBe(2_000);
  });
});

describe('tier vocabulary — normalize + compare', () => {
  it('maps legacy vocabulary forward when legacy=true', () => {
    expect(normalizeTier('starter', true)).toBe('pro');
    expect(normalizeTier('pro', true)).toBe('max');
    expect(normalizeTier('free', true)).toBe('free');
  });

  it('passes current vocabulary through when legacy=false', () => {
    expect(normalizeTier('pro', false)).toBe('pro');
    expect(normalizeTier('max', false)).toBe('max');
    expect(normalizeTier('starter', false)).toBe('free'); // unknown → free
  });

  it('compareTiers orders free < pro < max', () => {
    expect(compareTiers('pro', 'free')).toBeGreaterThan(0);
    expect(compareTiers('free', 'max')).toBeLessThan(0);
    expect(compareTiers('pro', 'pro')).toBe(0);
  });
});

describe('CREDIT_PACKAGES — renamed ids resolve', () => {
  it('exposes small/medium/large and resolves via getCreditPackage', () => {
    expect(CREDIT_PACKAGES.map((p) => p.id)).toEqual(['small', 'medium', 'large']);
    expect(getCreditPackage('medium')?.credits).toBe(5_000);
  });
});
