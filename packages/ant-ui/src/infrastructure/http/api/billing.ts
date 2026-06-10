/**
 * Billing API client — balance / usage / top-up.
 *
 * Mirrors the BE contract in
 * `packages/ant-cli/src/periphery/adapters/http/routes/billing.routes.ts`.
 * Types come from `@ant/shared` so FE and BE stay in lockstep.
 */

import { API_BASE, apiGet, apiPost } from './client';
import type { BalanceSnapshot, UsageHistoryResponse } from '@ant/shared';

export type { BalanceSnapshot, UsageHistoryResponse } from '@ant/shared';

/** Current credit balance + tier. */
export async function fetchBalance(): Promise<BalanceSnapshot> {
  return apiGet<BalanceSnapshot>(`${API_BASE()}/billing/balance`);
}

/** Recent transactions (newest first). USD fields are stripped for non-operators. */
export async function fetchUsage(limit = 50): Promise<UsageHistoryResponse> {
  return apiGet<UsageHistoryResponse>(`${API_BASE()}/billing/usage?limit=${limit}`);
}

/** Purchase credits via the (stub) payment provider. Returns the new balance. */
export async function topUpCredits(credits: number, idempotencyKey?: string): Promise<BalanceSnapshot> {
  return apiPost<BalanceSnapshot>(`${API_BASE()}/billing/topup`, {
    credits,
    idempotencyKey: idempotencyKey ?? `topup-${Date.now()}`,
  });
}
