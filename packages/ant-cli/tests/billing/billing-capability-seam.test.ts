/**
 * Billing seam — cloud-only + dormant no-op fallback.
 *
 * Locks: `isBillingEnabled()` is true ONLY in cloud mode (`ANT_SERVER_MODE=cloud`);
 * local mode is free, so the factory wires the `Noop*` adapters and `/billing/*`
 * is unregistered. The retired `ANT_BILLING_ENABLED` env has no effect. The
 * `Noop*` adapters double as the dormant fallback for the future `@ant/cloud`
 * extraction and are exercised here directly.
 */

import { describe, it, expect } from 'vitest';
import { isBillingEnabled } from '../../src/core/config/billingCapability';
import { NoopCreditLedger } from '../../src/periphery/adapters/billing/NoopCreditLedger';
import { NoopPaymentProvider } from '../../src/periphery/adapters/billing/NoopPaymentProvider';

describe('isBillingEnabled', () => {
  const savedBilling = process.env.ANT_BILLING_ENABLED;
  const savedMode = process.env.ANT_SERVER_MODE;
  const restore = () => {
    if (savedBilling === undefined) delete process.env.ANT_BILLING_ENABLED;
    else process.env.ANT_BILLING_ENABLED = savedBilling;
    if (savedMode === undefined) delete process.env.ANT_SERVER_MODE;
    else process.env.ANT_SERVER_MODE = savedMode;
  };

  it('is true ONLY in cloud mode (local/unset = free), regardless of ANT_BILLING_ENABLED', () => {
    try {
      for (const billing of [undefined, 'false', '0', 'true']) {
        if (billing === undefined) delete process.env.ANT_BILLING_ENABLED;
        else process.env.ANT_BILLING_ENABLED = billing;

        process.env.ANT_SERVER_MODE = 'cloud';
        expect(isBillingEnabled()).toBe(true);

        for (const mode of [undefined, 'local']) {
          if (mode === undefined) delete process.env.ANT_SERVER_MODE;
          else process.env.ANT_SERVER_MODE = mode;
          expect(isBillingEnabled()).toBe(false);
        }
      }
    } finally {
      restore();
    }
  });
});

describe('NoopCreditLedger (dormant fallback)', () => {
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

describe('NoopPaymentProvider (dormant fallback)', () => {
  it('never approves a charge', async () => {
    const p = new NoopPaymentProvider();
    expect((await p.purchaseCredits({} as any)).ok).toBe(false);
    expect((await p.startSubscription()).ok).toBe(false);
  });
});
