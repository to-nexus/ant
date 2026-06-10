/**
 * PaymentProviderPort
 *
 * Abstraction over the real payment gateway (Stripe / Toss / etc.). Kept
 * deliberately thin — the current vertical slice ships a StubPaymentProvider
 * that credits the ledger directly (no real PG). Swapping in a real provider
 * later requires only a new adapter, not changes to callers.
 */

export interface TopUpRequest {
  orgId: string;
  userId: string;
  /** Displayed credits to purchase. */
  credits: number;
  /** Dedupe key for retried purchases. */
  idempotencyKey: string;
}

export interface TopUpResult {
  ok: boolean;
  transactionId?: string;
  reason?: string;
}

export interface PaymentProviderPort {
  /** Purchase credits. Stub credits the ledger immediately. */
  topUp(req: TopUpRequest): Promise<TopUpResult>;

  /** Start/upgrade a subscription tier. Stub is a no-op success. */
  startSubscription(orgId: string, userId: string, tier: string): Promise<{ ok: boolean }>;

  /** Cancel a subscription. Stub is a no-op success. */
  cancelSubscription(orgId: string, userId: string): Promise<{ ok: boolean }>;
}
