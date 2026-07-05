/**
 * Pricing cutover math — `1 credit = $1`, sub-cent internal precision, currency
 * display, and the billing task-count predicate. Guards the @ant/shared side of
 * the overhaul (the cloud ledger/catalog fee is tested in the cloud suite).
 */
import { describe, it, expect } from 'vitest';
import {
  USD_PER_CREDIT,
  MICRO_PER_CREDIT,
  BILLING_SCHEMA_VERSION,
  TIER_VOCAB_SCHEMA_VERSION,
  usdToMicroCredits,
  microCreditsToCredits,
  creditsToMicroCredits,
  isBillableWorkTask,
} from '@ant/shared';
import { formatCredits } from '../../../ant-ui/src/shared/utils/tokenUtils';

describe('pricing cutover — 1 credit = $1', () => {
  it('constants reflect par + sub-cent atomic unit', () => {
    expect(USD_PER_CREDIT).toBe(1.0);
    expect(MICRO_PER_CREDIT).toBe(100_000); // atomic unit = $0.00001
    expect(BILLING_SCHEMA_VERSION).toBe(3);
    expect(TIER_VOCAB_SCHEMA_VERSION).toBe(2);
  });

  it('pass-through: $1 of LLM cost = 1 credit at markup 1.0', () => {
    // usdToMicroCredits($1, 1.0) = 1 credit worth of micro.
    expect(usdToMicroCredits(1, 1.0)).toBe(MICRO_PER_CREDIT);
    expect(microCreditsToCredits(usdToMicroCredits(1, 1.0))).toBe(1);
  });

  it('keeps sub-cent precision (no cent-level truncation)', () => {
    // $0.00003 → ceil to the $0.00001 atomic unit = 3 micro, exact — not 0, not a cent.
    expect(usdToMicroCredits(0.00003, 1.0)).toBe(3);
    expect(microCreditsToCredits(3)).toBeCloseTo(0.00003, 8);
  });

  it('round-trips credits ↔ micro at the new unit', () => {
    expect(creditsToMicroCredits(0.02)).toBe(2_000);
    expect(microCreditsToCredits(2_000)).toBe(0.02);
    expect(microCreditsToCredits(creditsToMicroCredits(19.75))).toBeCloseTo(19.75, 8);
  });

  it('formatCredits is currency-style (cents preserved, no compaction until huge)', () => {
    expect(formatCredits(19.756)).toBe('19.76');
    expect(formatCredits(0.1)).toBe('0.10');
    expect(formatCredits(2)).toBe('2.00');
    expect(formatCredits(0)).toBe('0.00');
    // only very large balances compact
    expect(formatCredits(250_000)).not.toContain('.');
  });

  it('isBillableWorkTask excludes verification + error (batchSplit-safe)', () => {
    expect(isBillableWorkTask({ type: 'feature' })).toBe(true);
    expect(isBillableWorkTask({ type: 'ui' })).toBe(true);
    expect(isBillableWorkTask({ type: 'setup' })).toBe(true);
    expect(isBillableWorkTask({ type: 'verification' })).toBe(false);
    expect(isBillableWorkTask({ type: 'error' })).toBe(false);
    expect(isBillableWorkTask(undefined)).toBe(false);
    // A mixed completed set counts only the user-facing work tasks.
    const completed = [
      { type: 'feature' },
      { type: 'feature' },
      { type: 'verification' },
      { type: 'error' }, // e.g. a batchSplit child
    ];
    expect(completed.filter(isBillableWorkTask).length).toBe(2);
  });
});
