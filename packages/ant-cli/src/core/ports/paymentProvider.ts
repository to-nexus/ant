/**
 * PaymentProviderPort
 *
 * Abstraction over the real payment gateway (Stripe / Toss / etc.). The current
 * vertical slice ships a MockPaymentProvider that simulates a card charge and,
 * on success, credits the ledger. Swapping in a real provider later requires
 * only a new adapter — callers (route, factory) are unchanged.
 *
 * The request is money-aware: `credits` + `amountUsd` are resolved server-side
 * from the CREDIT_PACKAGES SSOT (never trusted from the client).
 */

import type { PaymentMethodInput, PurchaseOutcome, SubscriptionTier } from '@ant/shared';

/** Outcome of a subscription charge. Mirrors {@link PurchaseOutcome}'s failure shape. */
export interface SubscriptionOutcome {
  ok: boolean;
  status?: 'succeeded' | 'declined' | 'error';
  /** Provider subscription reference on success (mock: synthetic). */
  providerRef?: string;
  declineCode?: string;
  reason?: string;
}

export interface PurchaseRequest {
  orgId: string;
  userId: string;
  /** Package identifier (CREDIT_PACKAGES SSOT). */
  packageId: string;
  /** Server-resolved displayed credits to grant on success. */
  credits: number;
  /** Server-resolved charge amount in USD. */
  amountUsd: number;
  /** Collected payment instrument (mock card / future tokenized handle). */
  paymentMethod: PaymentMethodInput;
  /** Dedupe key for retried purchases. */
  idempotencyKey: string;
}

export interface PaymentProviderPort {
  /** Charge the payment method and, on success, credit the ledger. */
  purchaseCredits(req: PurchaseRequest): Promise<PurchaseOutcome>;

  /**
   * Charge for a subscription tier change. The provider ONLY charges — the
   * route owns the tier-change + grant (mirrors how `purchaseCredits` delegates
   * the grant to `ledger.topUp`). A `paymentMethod` exercises the decline path.
   */
  startSubscription(
    orgId: string,
    userId: string,
    tier: SubscriptionTier,
    paymentMethod?: PaymentMethodInput,
  ): Promise<SubscriptionOutcome>;

  /** Stop auto-renew at the gateway. Mock is a no-op success. */
  cancelSubscription(orgId: string, userId: string): Promise<SubscriptionOutcome>;

  /**
   * True when this is a mock/stub provider (no real PG). Gates the dev-only
   * arbitrary credit top-up: while mock, the customer may add any credit amount
   * without a real charge. A real provider returns false, disabling that path.
   */
  isMock?(): boolean;
}
