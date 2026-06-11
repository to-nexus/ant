/**
 * POST /billing/subscribe + /billing/cancel-subscription + GET /billing/catalog.
 *
 * Locks: the subscribe price/plan come from the catalog SSOT (tier is validated
 * server-side); `free`/unknown tiers are 400; a declined charge is a 402; a
 * successful charge returns the extended BalanceSnapshot via ledger.changeTier;
 * cancel routes through the ledger. No supertest — real Express on port 0.
 */

import { describe, it, expect, vi } from 'vitest';
import http from 'node:http';
import express from 'express';

vi.mock('../../src/periphery/adapters/http/routes/helpers/userContext', () => ({
  extractUserContext: () => ({ userId: 'user1', organizationId: 'org1' }),
}));

import { createBillingRoutes } from '../../src/periphery/adapters/http/routes/billing.routes';
import type { CreditLedgerPort } from '../../src/core/ports/creditLedger';
import type { PaymentProviderPort, SubscriptionOutcome } from '../../src/core/ports/paymentProvider';
import type { BalanceSnapshot, SubscriptionTier } from '@ant/shared';

class FakeLedger implements Partial<CreditLedgerPort> {
  lastChange: { tier: SubscriptionTier } | null = null;
  canceled = false;
  async getBalance(): Promise<any> {
    return { tier: 'free', microCredits: 0, credits: 0, includedCreditsMonthly: 200, status: 'none' };
  }
  async changeTier(_o: string, _u: string, tier: SubscriptionTier): Promise<BalanceSnapshot> {
    this.lastChange = { tier };
    return { tier, microCredits: 2_000_000, credits: 2_000, includedCreditsMonthly: 2_000, status: 'active', currentPlanId: tier };
  }
  async cancelSubscription(): Promise<BalanceSnapshot> {
    this.canceled = true;
    return { tier: 'pro', microCredits: 0, credits: 0, includedCreditsMonthly: 2_000, status: 'canceled' };
  }
}

class FakeProvider implements PaymentProviderPort {
  startCalls = 0;
  constructor(private readonly outcome: SubscriptionOutcome) {}
  async purchaseCredits(): Promise<any> { return { ok: true, status: 'succeeded' }; }
  async startSubscription(): Promise<SubscriptionOutcome> {
    this.startCalls++;
    return this.outcome;
  }
  async cancelSubscription(): Promise<SubscriptionOutcome> { return { ok: true }; }
}

async function withServer(
  ledger: Partial<CreditLedgerPort>,
  provider: PaymentProviderPort,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api', createBillingRoutes({ creditLedger: ledger as any, paymentProvider: provider }));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const subscribe = (base: string, body: unknown) =>
  fetch(`${base}/api/billing/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /billing/subscribe', () => {
  it('charges and applies the tier via the ledger on success', async () => {
    const ledger = new FakeLedger();
    const provider = new FakeProvider({ ok: true, status: 'succeeded', providerRef: 'mock_sub' });
    await withServer(ledger, provider, async (base) => {
      const res = await subscribe(base, { tier: 'pro', paymentMethod: { cardNumber: '4242424242424242', expMonth: 12, expYear: 2099, cvc: '123' } });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tier).toBe('pro');
      expect(body.status).toBe('active');
      expect(ledger.lastChange?.tier).toBe('pro');
    });
  });

  it('400s on the free tier (that is a cancellation, not a subscribe)', async () => {
    const ledger = new FakeLedger();
    const provider = new FakeProvider({ ok: true });
    await withServer(ledger, provider, async (base) => {
      const res = await subscribe(base, { tier: 'free' });
      expect(res.status).toBe(400);
      expect(provider.startCalls).toBe(0);
    });
  });

  it('400s on an unknown tier', async () => {
    const ledger = new FakeLedger();
    const provider = new FakeProvider({ ok: true });
    await withServer(ledger, provider, async (base) => {
      const res = await subscribe(base, { tier: 'ultra' });
      expect(res.status).toBe(400);
    });
  });

  it('402s when the charge is declined', async () => {
    const ledger = new FakeLedger();
    const provider = new FakeProvider({ ok: false, status: 'declined', declineCode: 'card_declined', reason: 'card declined' });
    await withServer(ledger, provider, async (base) => {
      const res = await subscribe(base, { tier: 'max', paymentMethod: { cardNumber: '4000000000000002', expMonth: 12, expYear: 2099, cvc: '123' } });
      expect(res.status).toBe(402);
      const body = await res.json();
      expect(body.code).toBe('declined');
      expect(ledger.lastChange).toBeNull(); // tier not applied on decline
    });
  });
});

describe('POST /billing/cancel-subscription', () => {
  it('routes through the ledger and returns the canceled snapshot', async () => {
    const ledger = new FakeLedger();
    const provider = new FakeProvider({ ok: true });
    await withServer(ledger, provider, async (base) => {
      const res = await fetch(`${base}/api/billing/cancel-subscription`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('canceled');
      expect(ledger.canceled).toBe(true);
    });
  });
});

describe('GET /billing/catalog', () => {
  it('returns plans (free/pro/max) and credit packages (small/medium/large)', async () => {
    const ledger = new FakeLedger();
    const provider = new FakeProvider({ ok: true });
    await withServer(ledger, provider, async (base) => {
      const res = await fetch(`${base}/api/billing/catalog`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.plans.map((p: any) => p.tier)).toEqual(['free', 'pro', 'max']);
      expect(body.creditPackages.map((p: any) => p.id)).toEqual(['small', 'medium', 'large']);
      expect(body.currency).toBe('usd');
    });
  });
});
