/**
 * Billing API client — balance / usage / top-up.
 *
 * Mirrors the BE contract in
 * `packages/ant-cli/src/periphery/adapters/http/routes/billing.routes.ts`.
 * Types come from `@ant/shared` so FE and BE stay in lockstep.
 */

import { API_BASE, apiGet, apiPost } from './client';
import type {
  BalanceSnapshot,
  BillingCatalog,
  PaymentMethodInput,
  SubscriptionTier,
  UsageHistoryResponse,
} from '@ant/shared';

export type { BalanceSnapshot, UsageHistoryResponse, BillingCatalog } from '@ant/shared';

/** Server-driven plan + credit-package offering. */
export async function fetchCatalog(): Promise<BillingCatalog> {
  return apiGet<BillingCatalog>(`${API_BASE()}/billing/catalog`);
}

/** Current credit balance + tier. */
export async function fetchBalance(): Promise<BalanceSnapshot> {
  return apiGet<BalanceSnapshot>(`${API_BASE()}/billing/balance`);
}

/** Recent transactions (newest first). USD fields are stripped for non-operators. */
export async function fetchUsage(limit = 50): Promise<UsageHistoryResponse> {
  return apiGet<UsageHistoryResponse>(`${API_BASE()}/billing/usage?limit=${limit}`);
}

/**
 * Purchase a credit package via the (mock) payment provider. Price + credits
 * are resolved server-side from the package id. Returns the new balance on
 * success; throws `ApiError` (status 402, `code` = 'declined' | 'error') on
 * a failed charge so the caller can surface the decline.
 */
export async function purchaseCredits(
  packageId: string,
  paymentMethod: PaymentMethodInput,
  idempotencyKey?: string,
): Promise<BalanceSnapshot> {
  return apiPost<BalanceSnapshot>(`${API_BASE()}/billing/purchase`, {
    packageId,
    paymentMethod,
    idempotencyKey: idempotencyKey ?? `purchase-${Date.now()}`,
  });
}

/**
 * Subscribe to / change a plan tier via the (mock) payment provider. The price
 * is resolved server-side from the tier. Returns the new balance; throws
 * `ApiError` (status 402, `code` = 'declined' | 'error') on a failed charge.
 */
export async function subscribePlan(
  tier: SubscriptionTier,
  paymentMethod?: PaymentMethodInput,
  idempotencyKey?: string,
): Promise<BalanceSnapshot> {
  return apiPost<BalanceSnapshot>(`${API_BASE()}/billing/subscribe`, {
    tier,
    paymentMethod,
    idempotencyKey: idempotencyKey ?? `subscribe-${Date.now()}`,
  });
}

/** Cancel the active subscription (cycle-end downgrade to free). */
export async function cancelSubscription(): Promise<BalanceSnapshot> {
  return apiPost<BalanceSnapshot>(`${API_BASE()}/billing/cancel-subscription`, {});
}

/**
 * DEV-only arbitrary credit top-up (no card) — enabled while the BE runs the
 * mock payment provider. Adds `credits` to the balance directly. Throws
 * `ApiError` (403 `not-mock` once a real PG is wired, 400 `invalid-amount`).
 */
export async function topUpCustomCredits(
  credits: number,
  idempotencyKey?: string,
): Promise<BalanceSnapshot> {
  return apiPost<BalanceSnapshot>(`${API_BASE()}/billing/topup-custom`, {
    credits,
    idempotencyKey: idempotencyKey ?? `topup-custom-${Date.now()}`,
  });
}
