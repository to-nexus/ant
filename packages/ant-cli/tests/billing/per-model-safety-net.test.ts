/**
 * Verify-before-settle safety-net — the billing backstop for the per-model
 * accounting bug (`slow-earning-heron`: per-model map ≈254K while the aggregate
 * was ≈12M, causing a ~55× undercharge).
 *
 * `reconcilePerModelUsage` cross-checks the per-model map's input-side tokens
 * against the authoritative aggregate. On a large drop it attributes the
 * shortfall to the most-expensive model present so a regression over-charges
 * slightly rather than silently under-charging. Priced via the unchanged
 * `computeJobCostUsd`.
 */
import { describe, it, expect } from 'vitest';
import {
  reconcilePerModelUsage,
  computeJobCostUsd,
  inputSideTokens,
  sumInputSideTokens,
  MOST_EXPENSIVE_MODEL_ID,
} from '@ant/shared';

const u = (input: number, output: number, cacheRead = 0) => ({
  inputTokens: input,
  outputTokens: output,
  totalTokens: input + output,
  cacheReadTokens: cacheRead,
});

describe('input-side token helpers', () => {
  it('inputSideTokens = new input + cache read + cache creation', () => {
    expect(inputSideTokens({ inputTokens: 100, outputTokens: 5, cacheReadTokens: 30, cacheCreationTokens: 10 })).toBe(140);
  });
  it('sumInputSideTokens sums across models', () => {
    expect(sumInputSideTokens({ a: u(100, 1, 20), b: u(50, 1, 0) })).toBe(170);
  });
});

describe('reconcilePerModelUsage — safety-net', () => {
  it('leaves a conserved map untouched (no correction)', () => {
    const byModel = { 'deepseek-v4-pro': u(1000, 40, 500) };
    const agg = sumInputSideTokens(byModel); // 1500
    const r = reconcilePerModelUsage(byModel, agg, 40);
    expect(r.corrected).toBe(false);
    expect(r.byModel).toBe(byModel); // same reference, no copy
  });

  it('tolerates a small (<2%) shortfall without correcting', () => {
    const byModel = { 'deepseek-v4-pro': u(990, 40, 0) };
    const r = reconcilePerModelUsage(byModel, 1000, 40); // 1% short
    expect(r.corrected).toBe(false);
  });

  it('corrects a large drop by attributing the shortfall to the present model', () => {
    // The slow-earning-heron shape: map holds ~254K, aggregate ~12.2M input-side.
    const byModel = { 'deepseek-v4-pro': u(254_000, 4_600, 220_000) };
    const perModelInput = sumInputSideTokens(byModel); // 474_000
    const aggregateInputSide = 23_000_000; // 12.2M new + 10.8M cache-read
    const aggregateOutput = 114_000;

    const r = reconcilePerModelUsage(byModel, aggregateInputSide, aggregateOutput);
    expect(r.corrected).toBe(true);
    expect(r.targetModelId).toBe('deepseek-v4-pro');
    expect(r.shortfallInput).toBe(aggregateInputSide - perModelInput);
    // The corrected map now conserves the aggregate input-side total.
    expect(sumInputSideTokens(r.byModel)).toBe(aggregateInputSide);
    // Priced cost is now dollars, not the broken ~$0.11.
    const { usd } = computeJobCostUsd(r.byModel);
    expect(usd).toBeGreaterThan(5);
    // Input map is never mutated in place.
    expect(byModel['deepseek-v4-pro'].inputTokens).toBe(254_000);
  });

  it('falls back to the most-expensive model when the map is degenerate', () => {
    const byModel: Record<string, any> = { unknownzzz: u(10, 1, 0) };
    const r = reconcilePerModelUsage(byModel, 1_000_000, 5000);
    expect(r.corrected).toBe(true);
    // 'unknownzzz' has no rate → bestRate stays -1 → default fallback.
    expect(r.targetModelId).toBe(MOST_EXPENSIVE_MODEL_ID);
  });

  it('picks the most-EXPENSIVE present model for the shortfall (soft over-charge)', () => {
    const byModel = { 'deepseek-v4-pro': u(100, 1, 0), 'claude-opus-4-8': u(100, 1, 0) };
    const r = reconcilePerModelUsage(byModel, 1_000_000, 5000);
    expect(r.corrected).toBe(true);
    expect(r.targetModelId).toBe('claude-opus-4-8'); // opus input rate > deepseek
  });
});

/**
 * Ground-truth tie-in: the CORRECT per-model map for `slow-earning-heron`
 * (from summing the debug token log by modelId) must price to dollars, not the
 * broken $0.12 the buggy 254K map produced. Locks the fix to the real numbers.
 */
describe('slow-earning-heron ground truth', () => {
  it('the correctly-attributed per-model map prices to ~$6.5, not $0.12', () => {
    const byModel = {
      // Debug log grouped by modelId: new input / output / cache-read.
      'deepseek-v4-pro': { inputTokens: 12_218_794, outputTokens: 114_379, totalTokens: 12_333_173, cacheReadTokens: 10_796_416, cacheCreationTokens: 0 },
      'claude-opus-4-8': { inputTokens: 147_079, outputTokens: 15_027, totalTokens: 162_106, cacheReadTokens: 0, cacheCreationTokens: 0 },
    };
    const { usd } = computeJobCostUsd(byModel);
    expect(usd).toBeGreaterThan(6);
    expect(usd).toBeLessThan(8);
    // The buggy 254K-only map priced to ~$0.11 — guard the ~55× gap is closed.
    const buggy = computeJobCostUsd({ 'deepseek-v4-pro': u(254_000, 4_600, 220_000) });
    expect(usd / buggy.usd).toBeGreaterThan(40);
  });
});
