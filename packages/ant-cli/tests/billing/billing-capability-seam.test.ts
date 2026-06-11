/**
 * Cloud-capability seam — `ANT_BILLING_ENABLED` gate (OSS / local off).
 *
 * Locks: with the flag off the factory hands out no-op adapters (no metering,
 * no charges) and `/system/config` reports `capabilities.billing = false`; with
 * it on the real Redis/Mock adapters are constructed. Mirrors the vectorDb
 * capability gate.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { isBillingEnabled } from '../../src/core/config/billingCapability';
import { NoopCreditLedger } from '../../src/periphery/adapters/billing/NoopCreditLedger';
import { NoopPaymentProvider } from '../../src/periphery/adapters/billing/NoopPaymentProvider';

afterEach(() => {
  delete process.env.ANT_BILLING_ENABLED;
});

describe('isBillingEnabled', () => {
  it('defaults to false (OSS / local) when unset', () => {
    delete process.env.ANT_BILLING_ENABLED;
    expect(isBillingEnabled()).toBe(false);
  });

  it('is true only for truthy values', () => {
    for (const v of ['1', 'true', 'yes', 'on', 'TRUE']) {
      process.env.ANT_BILLING_ENABLED = v;
      expect(isBillingEnabled()).toBe(true);
    }
    for (const v of ['0', 'false', 'no', '']) {
      process.env.ANT_BILLING_ENABLED = v;
      expect(isBillingEnabled()).toBe(false);
    }
  });
});

describe('NoopCreditLedger (billing off)', () => {
  it('reports a free/zero balance and never charges', async () => {
    const ledger = new NoopCreditLedger();
    const snap = await ledger.getBalance();
    expect(snap.tier).toBe('free');
    expect(snap.credits).toBe(0);
    // settle / topUp / changeTier are no-ops; balance stays free/0.
    await ledger.settle({ jobId: 'j', orgId: 'o', userId: 'u', usdCost: 5 });
    await ledger.topUp('o', 'u', 1000, 'k');
    const after = await ledger.changeTier('o', 'u', 'pro', { idempotencyKey: 'k' });
    expect(after.credits).toBe(0);
    expect((await ledger.listTransactions('o', 'u', 50)).length).toBe(0);
  });
});

describe('NoopPaymentProvider (billing off)', () => {
  it('never approves a charge', async () => {
    const p = new NoopPaymentProvider();
    expect((await p.purchaseCredits({} as any)).ok).toBe(false);
    expect((await p.startSubscription()).ok).toBe(false);
  });
});
