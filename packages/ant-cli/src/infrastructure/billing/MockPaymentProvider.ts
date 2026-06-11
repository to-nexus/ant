/**
 * MockPaymentProvider — simulates a card charge, no real payment gateway.
 *
 * Validates the (mock) card, simulates approval/decline via Stripe-style test
 * cards, and on success credits the ledger (idempotent via the ledger's dedupe
 * key). Swapping in a real provider later is a new adapter; callers unchanged.
 */

import type {
  PaymentProviderPort,
  PurchaseRequest,
  SubscriptionOutcome,
} from '../../core/ports/paymentProvider';
import type { CreditLedgerPort } from '../../core/ports/creditLedger';
import { MOCK_DECLINE_CARD, type PaymentMethodInput, type PurchaseOutcome, type SubscriptionTier } from '@ant/shared';
import { logger } from '../../utils/logger';

const COMPONENT = 'MockPaymentProvider';

export class MockPaymentProvider implements PaymentProviderPort {
  constructor(private readonly ledger: CreditLedgerPort) {}

  /** Mock provider — enables the dev-only arbitrary credit top-up. */
  isMock(): boolean {
    return true;
  }

  async purchaseCredits(req: PurchaseRequest): Promise<PurchaseOutcome> {
    if (req.credits <= 0 || req.amountUsd <= 0) {
      return { ok: false, status: 'error', reason: 'invalid package' };
    }

    const malformed = validateCard(req.paymentMethod);
    if (malformed) {
      return { ok: false, status: 'error', reason: malformed };
    }

    const pan = normalizePan(req.paymentMethod.cardNumber);
    if (pan === MOCK_DECLINE_CARD) {
      logger.info(`mock charge declined: ${req.orgId}:${req.userId} $${req.amountUsd}`, {
        component: COMPONENT,
      });
      return { ok: false, status: 'declined', declineCode: 'card_declined', reason: 'card declined' };
    }

    // Approved — credit the ledger (idempotent on idempotencyKey).
    await this.ledger.topUp(req.orgId, req.userId, req.credits, req.idempotencyKey);
    logger.info(
      `mock charge approved: +${req.credits} credits ($${req.amountUsd}) for ${req.orgId}:${req.userId}`,
      { component: COMPONENT },
    );
    return {
      ok: true,
      status: 'succeeded',
      transactionId: `mock_pi_${req.idempotencyKey}`,
      creditsAdded: req.credits,
      amountChargedUsd: req.amountUsd,
    };
  }

  /**
   * Charge for a subscription. Mirrors `purchaseCredits`'s card validation +
   * decline path. Does NOT touch the ledger — the route owns the tier change
   * + grant (same charge/grant split as `purchaseCredits` → `ledger.topUp`).
   */
  async startSubscription(
    orgId: string,
    userId: string,
    tier: SubscriptionTier,
    paymentMethod?: PaymentMethodInput,
  ): Promise<SubscriptionOutcome> {
    if (paymentMethod) {
      const malformed = validateCard(paymentMethod);
      if (malformed) return { ok: false, status: 'error', reason: malformed };
      if (normalizePan(paymentMethod.cardNumber) === MOCK_DECLINE_CARD) {
        logger.info(`mock subscription declined: ${orgId}:${userId} → ${tier}`, { component: COMPONENT });
        return { ok: false, status: 'declined', declineCode: 'card_declined', reason: 'card declined' };
      }
    }
    logger.info(`mock startSubscription: ${orgId}:${userId} → ${tier}`, { component: COMPONENT });
    return { ok: true, status: 'succeeded', providerRef: `mock_sub_${orgId}_${userId}_${tier}` };
  }

  async cancelSubscription(orgId: string, userId: string): Promise<SubscriptionOutcome> {
    logger.info(`mock cancelSubscription: ${orgId}:${userId}`, { component: COMPONENT });
    return { ok: true, status: 'succeeded' };
  }
}

function normalizePan(cardNumber: string): string {
  return (cardNumber ?? '').replace(/\s+/g, '');
}

/** Returns a reason string when the card is malformed, or null when well-formed. */
function validateCard(pm: { cardNumber: string; expMonth: number; expYear: number; cvc: string }): string | null {
  const pan = normalizePan(pm.cardNumber);
  if (!/^\d{15,16}$/.test(pan)) return 'invalid card number';
  if (!/^\d{3,4}$/.test(String(pm.cvc ?? ''))) return 'invalid cvc';
  if (!Number.isInteger(pm.expMonth) || pm.expMonth < 1 || pm.expMonth > 12) return 'invalid expiry month';
  if (!Number.isInteger(pm.expYear) || pm.expYear < 2000 || pm.expYear > 2100) return 'invalid expiry year';

  const now = new Date();
  // Card is valid through the end of its expiry month.
  const expiresAfter = new Date(pm.expYear, pm.expMonth, 1);
  if (expiresAfter <= now) return 'card expired';

  return null;
}
