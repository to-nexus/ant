/**
 * POST /billing/purchase — route contract.
 *
 * Locks: price + credits come from the CREDIT_PACKAGES SSOT (a client that
 * spoofs `credits`/`amountUsd` in the body is ignored); an unknown package is
 * a 400; a declined charge is a 402 carrying the decline code.
 *
 * No supertest — bind a real Express app to port 0 and call it via fetch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import express from 'express';

// Fix the tenant so the route doesn't probe the filesystem for a local default.
vi.mock('../../src/periphery/adapters/http/routes/helpers/userContext', () => ({
  extractUserContext: () => ({ userId: 'user1', organizationId: 'org1' }),
}));

import { createBillingRoutes } from '../../src/periphery/adapters/http/routes/billing.routes';
import type { CreditLedgerPort } from '../../src/core/ports/creditLedger';
import type { PaymentProviderPort, PurchaseRequest } from '../../src/core/ports/paymentProvider';
import type { PurchaseOutcome } from '@ant/shared';

class FakeLedger implements Partial<CreditLedgerPort> {
  async getBalance(): Promise<any> {
    return { tier: 'free', microCredits: 5_000_000, credits: 5_000, includedCreditsMonthly: 200 };
  }
}

class CapturingProvider implements PaymentProviderPort {
  lastReq: PurchaseRequest | null = null;
  constructor(private readonly outcome: PurchaseOutcome) {}
  async purchaseCredits(req: PurchaseRequest): Promise<PurchaseOutcome> {
    this.lastReq = req;
    return this.outcome;
  }
  async startSubscription() { return { ok: true }; }
  async cancelSubscription() { return { ok: true }; }
}

async function withServer(
  provider: PaymentProviderPort,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api', createBillingRoutes({ creditLedger: new FakeLedger() as any, paymentProvider: provider }));
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

const post = (base: string, body: unknown) =>
  fetch(`${base}/api/billing/purchase`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /billing/purchase', () => {
  it('resolves price/credits from the SSOT and ignores client-sent amount/credits', async () => {
    const provider = new CapturingProvider({ ok: true, status: 'succeeded' });
    await withServer(provider, async (base) => {
      const res = await post(base, {
        packageId: 'plus',
        credits: 999_999, // spoof — must be ignored
        amountUsd: 0.01, // spoof — must be ignored
        paymentMethod: { cardNumber: '4242424242424242', expMonth: 12, expYear: 2099, cvc: '123' },
      });
      expect(res.status).toBe(200);
      expect(provider.lastReq?.credits).toBe(5_000); // from CREDIT_PACKAGES.plus
      expect(provider.lastReq?.amountUsd).toBe(50);
      expect(provider.lastReq?.packageId).toBe('plus');
    });
  });

  it('400s on an unknown package id', async () => {
    const provider = new CapturingProvider({ ok: true, status: 'succeeded' });
    await withServer(provider, async (base) => {
      const res = await post(base, {
        packageId: 'mega',
        paymentMethod: { cardNumber: '4242424242424242', expMonth: 12, expYear: 2099, cvc: '123' },
      });
      expect(res.status).toBe(400);
      expect(provider.lastReq).toBeNull();
    });
  });

  it('402s with the decline code when the charge is declined', async () => {
    const provider = new CapturingProvider({
      ok: false,
      status: 'declined',
      declineCode: 'card_declined',
      reason: 'card declined',
    });
    await withServer(provider, async (base) => {
      const res = await post(base, {
        packageId: 'starter',
        paymentMethod: { cardNumber: '4000000000000002', expMonth: 12, expYear: 2099, cvc: '123' },
      });
      expect(res.status).toBe(402);
      const body = await res.json();
      expect(body.code).toBe('declined');
      expect(body.declineCode).toBe('card_declined');
    });
  });
});
