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

import type { PaymentMethodInput, PurchaseOutcome } from '@ant/shared';

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

  /** Start/upgrade a subscription tier. Mock is a no-op success. */
  startSubscription(orgId: string, userId: string, tier: string): Promise<{ ok: boolean }>;

  /** Cancel a subscription. Mock is a no-op success. */
  cancelSubscription(orgId: string, userId: string): Promise<{ ok: boolean }>;
}
