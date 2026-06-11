/**
 * Billing seam — always-on at this stage + dormant no-op fallback.
 *
 * Locks: `isBillingEnabled()` is unconditionally true (not env-controlled), so
 * the factory wires the real adapters and `/billing/*` is registered. The
 * `Noop*` adapters are retained as the dormant fallback for the future
 * `@ant/cloud` extraction and are exercised here directly.
 */

import { describe, it, expect } from 'vitest';
import { isBillingEnabled } from '../../src/core/config/billingCapability';
import { NoopCreditLedger } from '../../src/periphery/adapters/billing/NoopCreditLedger';
import { NoopPaymentProvider } from '../../src/periphery/adapters/billing/NoopPaymentProvider';

describe('isBillingEnabled', () => {
  it('is always true at this stage, regardless of env / server mode', () => {
    const savedBilling = process.env.ANT_BILLING_ENABLED;
    const savedMode = process.env.ANT_SERVER_MODE;
    try {
      for (const billing of [undefined, 'false', '0', 'true']) {
        for (const mode of [undefined, 'local', 'cloud']) {
          if (billing === undefined) delete process.env.ANT_BILLING_ENABLED;
          else process.env.ANT_BILLING_ENABLED = billing;
          if (mode === undefined) delete process.env.ANT_SERVER_MODE;
          else process.env.ANT_SERVER_MODE = mode;
          expect(isBillingEnabled()).toBe(true);
        }
      }
    } finally {
      if (savedBilling === undefined) delete process.env.ANT_BILLING_ENABLED;
      else process.env.ANT_BILLING_ENABLED = savedBilling;
      if (savedMode === undefined) delete process.env.ANT_SERVER_MODE;
      else process.env.ANT_SERVER_MODE = savedMode;
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
