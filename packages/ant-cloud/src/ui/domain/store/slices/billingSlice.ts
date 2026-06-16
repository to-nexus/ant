/**
 * Billing slice — credit balance + usage history.
 *
 * Stores flat `AsyncFields<T>` per the Async UI Policy
 * (docs/architecture/ui-async-policy.md). The customer surface speaks credits;
 * USD cost rides along on transactions only when the BE deems the caller an
 * operator (`canViewUsd`) — the FE never decides visibility itself.
 */

import { StateCreator } from 'zustand';
import { initialAsyncFields } from '@/domain/async';
import type { BalanceSnapshot, BillingCatalog, SubscriptionTier } from '@ant/shared';
import type { CreditTransaction, PaymentMethodInput, PurchaseOutcome } from '@ant/shared';
import {
  fetchBalance,
  fetchUsage,
  fetchCatalog,
  purchaseCredits,
  subscribePlan,
  cancelSubscription,
  topUpCustomCredits,
} from '@cloud/infrastructure/http/api/billing';
import { ApiError } from '@/infrastructure/http/api/client';
import { selectIsAuthBlocked } from '@/domain/store/selectors/auth';
import type { BillingSlice, BillingActions } from '@/domain/store/slices/billing.types';

export type { BillingSlice, BillingSliceState, BillingActions } from '@/domain/store/slices/billing.types';

export const createBillingSlice: StateCreator<any, [], [], BillingSlice> = (set, get) => ({
  billingBalance: initialAsyncFields<BalanceSnapshot>(),
  billingUsage: initialAsyncFields<CreditTransaction[]>(),
  billingCatalog: initialAsyncFields<BillingCatalog>(),
  billingCanViewUsd: false,
  creditBlockActive: false,

  setCreditBlockActive: (active: boolean) => set({ creditBlockActive: active }),

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

  refreshCatalog: async () => {
    if (selectIsAuthBlocked(get())) return;
    const cur = get().billingCatalog;
    if (cur.status === 'ready' || cur.refreshing) return; // catalog is static
    set((s: any) => ({ billingCatalog: { ...s.billingCatalog, refreshing: true } }));
    try {
      const data = await fetchCatalog();
      set({ billingCatalog: { status: 'ready', data, error: null, refreshing: false } });
    } catch (error) {
      set({
        billingCatalog: {
          status: 'error',
          data: null,
          error: error instanceof Error ? error : new Error(String(error)),
          refreshing: false,
        },
      });
    }
  },

  purchaseCredits: async (packageId: string, paymentMethod: PaymentMethodInput): Promise<PurchaseOutcome> => {
    try {
      const data = await purchaseCredits(packageId, paymentMethod);
      set({ billingBalance: { status: 'ready', data, error: null, refreshing: false } });
      // Refresh usage so the new top-up row appears.
      await (get() as BillingActions).refreshUsage();
      return { ok: true, status: 'succeeded' };
    } catch (error) {
      if (error instanceof ApiError) {
        // 402 → declined / error; any other status maps to a generic error.
        const status: PurchaseOutcome['status'] = error.code === 'declined' ? 'declined' : 'error';
        return { ok: false, status, reason: error.message };
      }
      return { ok: false, status: 'error', reason: error instanceof Error ? error.message : String(error) };
    }
  },

  subscribePlan: async (tier: SubscriptionTier, paymentMethod?: PaymentMethodInput): Promise<PurchaseOutcome> => {
    try {
      const data = await subscribePlan(tier, paymentMethod);
      set({ billingBalance: { status: 'ready', data, error: null, refreshing: false } });
      await (get() as BillingActions).refreshUsage();
      return { ok: true, status: 'succeeded' };
    } catch (error) {
      if (error instanceof ApiError) {
        const status: PurchaseOutcome['status'] = error.code === 'declined' ? 'declined' : 'error';
        return { ok: false, status, reason: error.message };
      }
      return { ok: false, status: 'error', reason: error instanceof Error ? error.message : String(error) };
    }
  },

  topUpCustomCredits: async (credits: number): Promise<PurchaseOutcome> => {
    try {
      const data = await topUpCustomCredits(credits);
      set({ billingBalance: { status: 'ready', data, error: null, refreshing: false } });
      await (get() as BillingActions).refreshUsage();
      return { ok: true, status: 'succeeded' };
    } catch (error) {
      if (error instanceof ApiError) {
        return { ok: false, status: 'error', reason: error.message };
      }
      return { ok: false, status: 'error', reason: error instanceof Error ? error.message : String(error) };
    }
  },

  cancelSubscription: async (): Promise<PurchaseOutcome> => {
    try {
      const data = await cancelSubscription();
      set({ billingBalance: { status: 'ready', data, error: null, refreshing: false } });
      await (get() as BillingActions).refreshUsage();
      return { ok: true, status: 'succeeded' };
    } catch (error) {
      if (error instanceof ApiError) {
        return { ok: false, status: 'error', reason: error.message };
      }
      return { ok: false, status: 'error', reason: error instanceof Error ? error.message : String(error) };
    }
  },
});
