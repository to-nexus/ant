/**
 * MockPaymentProvider — charge simulation contract.
 *
 * Locks: a well-formed card grants the EXACT package credits via the ledger;
 * the Stripe-style decline test card returns `declined` and NEVER touches the
 * ledger; a malformed card returns `error` and never touches the ledger; the
 * face-value package SSOT stays 1:1 with USD_PER_CREDIT.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockPaymentProvider } from '../../src/infrastructure/billing/MockPaymentProvider';
import type { CreditLedgerPort } from '../../src/core/ports/creditLedger';
import {
  MOCK_SUCCESS_CARD,
  MOCK_DECLINE_CARD,
  USD_PER_CREDIT,
  type PaymentMethodInput,
} from '@ant/shared';
import { CREDIT_PACKAGES, getCreditPackage } from '../../src/infrastructure/billing/catalog';

/** Ledger fake that records only topUp calls (the sole method the provider uses). */
class RecordingLedger implements Partial<CreditLedgerPort> {
  topUps: Array<{ orgId: string; userId: string; credits: number; key: string }> = [];
  async topUp(orgId: string, userId: string, credits: number, idempotencyKey: string): Promise<void> {
    this.topUps.push({ orgId, userId, credits, key: idempotencyKey });
  }
}

const goodCard = (cardNumber: string): PaymentMethodInput => ({
  cardNumber,
  expMonth: 12,
  expYear: 2099,
  cvc: '123',
});

const baseReq = (paymentMethod: PaymentMethodInput) => ({
  orgId: 'org1',
  userId: 'user1',
  packageId: 'medium',
  credits: 5_000,
  amountUsd: 50,
  paymentMethod,
  idempotencyKey: 'idem-1',
});

describe('MockPaymentProvider.purchaseCredits', () => {
  let ledger: RecordingLedger;
  let provider: MockPaymentProvider;

  beforeEach(() => {
    ledger = new RecordingLedger();
    provider = new MockPaymentProvider(ledger as unknown as CreditLedgerPort);
  });

  it('approves a well-formed card and grants the exact package credits', async () => {
    const out = await provider.purchaseCredits(baseReq(goodCard(MOCK_SUCCESS_CARD)));
    expect(out.ok).toBe(true);
    expect(out.status).toBe('succeeded');
    expect(out.creditsAdded).toBe(5_000);
    expect(out.amountChargedUsd).toBe(50);
    expect(out.transactionId).toBe('mock_pi_idem-1');
    expect(ledger.topUps).toEqual([{ orgId: 'org1', userId: 'user1', credits: 5_000, key: 'idem-1' }]);
  });

  it('declines the decline test card and never credits the ledger', async () => {
    const out = await provider.purchaseCredits(baseReq(goodCard(MOCK_DECLINE_CARD)));
    expect(out.ok).toBe(false);
    expect(out.status).toBe('declined');
    expect(out.declineCode).toBe('card_declined');
    expect(ledger.topUps).toHaveLength(0);
  });

  it('rejects a malformed card (short PAN) as error, no ledger call', async () => {
    const out = await provider.purchaseCredits(baseReq(goodCard('4242')));
    expect(out.ok).toBe(false);
    expect(out.status).toBe('error');
    expect(ledger.topUps).toHaveLength(0);
  });

  it('rejects an expired card as error, no ledger call', async () => {
    const out = await provider.purchaseCredits(
      baseReq({ cardNumber: MOCK_SUCCESS_CARD, expMonth: 1, expYear: 2000, cvc: '123' }),
    );
    expect(out.ok).toBe(false);
    expect(out.status).toBe('error');
    expect(ledger.topUps).toHaveLength(0);
  });
});

describe('CREDIT_PACKAGES SSOT', () => {
  it('every package is priced at face value (1:1 with USD_PER_CREDIT)', () => {
    for (const pkg of CREDIT_PACKAGES) {
      expect(pkg.priceUsd).toBeCloseTo(pkg.credits * USD_PER_CREDIT, 6);
    }
  });

  it('getCreditPackage resolves known ids and rejects unknown', () => {
    expect(getCreditPackage('medium')?.credits).toBe(5_000);
    expect(getCreditPackage('nope')).toBeUndefined();
  });
});

describe('MockPaymentProvider.startSubscription', () => {
  let provider: MockPaymentProvider;
  beforeEach(() => {
    provider = new MockPaymentProvider(new RecordingLedger() as unknown as CreditLedgerPort);
  });

  it('approves a well-formed card and returns a providerRef (no ledger mutation here)', async () => {
    const out = await provider.startSubscription('org1', 'user1', 'pro', goodCard(MOCK_SUCCESS_CARD));
    expect(out.ok).toBe(true);
    expect(out.providerRef).toBeTruthy();
  });

  it('declines the decline test card', async () => {
    const out = await provider.startSubscription('org1', 'user1', 'pro', goodCard(MOCK_DECLINE_CARD));
    expect(out.ok).toBe(false);
    expect(out.status).toBe('declined');
    expect(out.declineCode).toBe('card_declined');
  });

  it('rejects a malformed card as error', async () => {
    const out = await provider.startSubscription('org1', 'user1', 'pro', goodCard('4242'));
    expect(out.ok).toBe(false);
    expect(out.status).toBe('error');
  });

  it('succeeds without a payment method (provider charge optional in mock)', async () => {
    const out = await provider.startSubscription('org1', 'user1', 'max');
    expect(out.ok).toBe(true);
  });
});
