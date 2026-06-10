/**
 * Billing API client — balance / usage / top-up.
 *
 * Mirrors the BE contract in
 * `packages/ant-cli/src/periphery/adapters/http/routes/billing.routes.ts`.
 * Types come from `@ant/shared` so FE and BE stay in lockstep.
 */

import { API_BASE, apiGet, apiPost } from './client';
import type { BalanceSnapshot, UsageHistoryResponse, PaymentMethodInput } from '@ant/shared';

export type { BalanceSnapshot, UsageHistoryResponse } from '@ant/shared';

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
