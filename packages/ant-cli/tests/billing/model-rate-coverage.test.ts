/**
 * Rate-card coverage — every model that can reach the billing pipeline MUST have
 * an explicit rate, so it is priced at its own rate instead of the conservative
 * MOST_EXPENSIVE_MODEL_ID (Opus) fallback in `computeCallCostUsdSafe`.
 *
 * Guards the Gemini gap fixed alongside the GLM/DeepSeek cache double-count:
 * visual/creator jobs meter Gemini text + image models via tokenUsageByModel, so
 * a missing rate silently over-charges them at the Opus fallback.
 */
import { describe, it, expect } from 'vitest';
import { MODEL_REGISTRY, MODEL_RATE_CARD, computeCallCostUsdSafe } from '@ant/shared';

const GEMINI_MODELS = [
  'gemini-3.1-pro-preview',
  'gemini-3-flash',
  'gemini-3-pro-image',
  'gemini-3.1-flash-image',
];

describe('MODEL_RATE_CARD coverage', () => {
  it('every registry model with a rate is exposed in the rate card by id', () => {
    for (const spec of Object.values(MODEL_REGISTRY)) {
      if (spec.rate) expect(MODEL_RATE_CARD[spec.id]).toBe(spec.rate);
    }
  });

  it('all Gemini models are priced at their own rate (no Opus fallback)', () => {
    for (const id of GEMINI_MODELS) {
      expect(MODEL_RATE_CARD[id], `${id} missing from rate card`).toBeDefined();
      // A known id must not report the unknown-model fallback flag.
      const { unknownModelId } = computeCallCostUsdSafe(id, {
        inputTokens: 1000,
        outputTokens: 1000,
      });
      expect(unknownModelId, `${id} fell back to Opus pricing`).toBeUndefined();
    }
  });

  it('image models price output (the render) at the image-output rate', () => {
    // 1290 output tokens ≈ one image. Pro image_output = $120/MTok, Flash = $60/MTok.
    const pro = computeCallCostUsdSafe('gemini-3-pro-image', { inputTokens: 0, outputTokens: 1_000_000 }).usd;
    const flash = computeCallCostUsdSafe('gemini-3.1-flash-image', { inputTokens: 0, outputTokens: 1_000_000 }).usd;
    expect(pro).toBeCloseTo(120, 5);
    expect(flash).toBeCloseTo(60, 5);
  });

  it('Gemini 3.1 Pro text: input $2 / output $12 per MTok (≤200K tier)', () => {
    const usd = computeCallCostUsdSafe('gemini-3.1-pro-preview', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    }).usd;
    expect(usd).toBeCloseTo(2 + 12, 5);
  });
});
