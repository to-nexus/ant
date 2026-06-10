/**
 * Billing slice — credit balance + usage history.
 *
 * Stores flat `AsyncFields<T>` per the Async UI Policy
 * (docs/architecture/ui-async-policy.md). The customer surface speaks credits;
 * USD cost rides along on transactions only when the BE deems the caller an
 * operator (`canViewUsd`) — the FE never decides visibility itself.
 */

import { StateCreator } from 'zustand';
import type { AsyncFields } from '@/domain/async';
import { initialAsyncFields } from '@/domain/async';
import type { BalanceSnapshot } from '@ant/shared';
import type { CreditTransaction } from '@ant/shared';
import { fetchBalance, fetchUsage, topUpCredits } from '@/infrastructure/http/api';
import { selectIsAuthBlocked } from '../selectors/auth';

export interface BillingSliceState {
  billingBalance: AsyncFields<BalanceSnapshot>;
  billingUsage: AsyncFields<CreditTransaction[]>;
  /** BE-decided: whether USD cost columns may be shown to this caller. */
  billingCanViewUsd: boolean;
}

export interface BillingActions {
  refreshBalance: () => Promise<void>;
  refreshUsage: (limit?: number) => Promise<void>;
  topUp: (credits: number) => Promise<void>;
}

export type BillingSlice = BillingSliceState & BillingActions;

export const createBillingSlice: StateCreator<any, [], [], BillingSlice> = (set, get) => ({
  billingBalance: initialAsyncFields<BalanceSnapshot>(),
  billingUsage: initialAsyncFields<CreditTransaction[]>(),
  billingCanViewUsd: false,

  refreshBalance: async () => {
    if (selectIsAuthBlocked(get())) return;
    set((s: any) => ({ billingBalance: { ...s.billingBalance, refreshing: true } }));
    try {
      const data = await fetchBalance();
      set({ billingBalance: { status: 'ready', data, error: null, refreshing: false } });
    } catch (error) {
      set({
        billingBalance: {
          status: 'error',
          data: null,
          error: error instanceof Error ? error : new Error(String(error)),
          refreshing: false,
        },
      });
    }
  },

  refreshUsage: async (limit = 50) => {
    if (selectIsAuthBlocked(get())) return;
    set((s: any) => ({ billingUsage: { ...s.billingUsage, refreshing: true } }));
    try {
      const res = await fetchUsage(limit);
      set({
        billingUsage: {
          status: res.transactions.length > 0 ? 'ready' : 'empty',
          data: res.transactions,
          error: null,
          refreshing: false,
        },
        billingCanViewUsd: res.canViewUsd,
      });
    } catch (error) {
      set({
        billingUsage: {
          status: 'error',
          data: null,
          error: error instanceof Error ? error : new Error(String(error)),
          refreshing: false,
        },
      });
    }
  },

  topUp: async (credits: number) => {
    const data = await topUpCredits(credits);
    set({ billingBalance: { status: 'ready', data, error: null, refreshing: false } });
    // Refresh usage so the new top-up row appears.
    await (get() as BillingActions).refreshUsage();
  },
});
