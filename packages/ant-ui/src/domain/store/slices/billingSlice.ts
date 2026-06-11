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
} from '@/infrastructure/http/api';
import { ApiError } from '@/infrastructure/http/api/client';
import { selectIsAuthBlocked } from '../selectors/auth';

export interface BillingSliceState {
  billingBalance: AsyncFields<BalanceSnapshot>;
  billingUsage: AsyncFields<CreditTransaction[]>;
  /** Server-driven plan + credit-package offering. */
  billingCatalog: AsyncFields<BillingCatalog>;
  /** BE-decided: whether USD cost columns may be shown to this caller. */
  billingCanViewUsd: boolean;
  /**
   * True when a job start/resume was just blocked by a 402 insufficient_credits.
   * Drives the recharge CTA shown near the chat input. Cleared on the next
   * successful start (or manual top-up navigation).
   */
  creditBlockActive: boolean;
}

export interface BillingActions {
  refreshBalance: () => Promise<void>;
  refreshUsage: (limit?: number) => Promise<void>;
  refreshCatalog: () => Promise<void>;
  /**
   * Purchase a credit package through the payment provider. Resolves to the
   * outcome (never throws) so the checkout UI can render a decline/error
   * inline. On success the balance + usage are refreshed.
   */
  purchaseCredits: (packageId: string, paymentMethod: PaymentMethodInput) => Promise<PurchaseOutcome>;
  /** Subscribe to / change a plan tier. Same outcome contract as purchaseCredits. */
  subscribePlan: (tier: SubscriptionTier, paymentMethod?: PaymentMethodInput) => Promise<PurchaseOutcome>;
  /** Cancel the active subscription (cycle-end downgrade). */
  cancelSubscription: () => Promise<PurchaseOutcome>;
  /** Set/clear the chat recharge-CTA flag (job start/resume blocked on credits). */
  setCreditBlockActive: (active: boolean) => void;
  /**
   * DEV-only arbitrary credit top-up (no card). Resolves to the outcome (never
   * throws); on success the balance + usage are refreshed. Disabled server-side
   * once a real payment gateway is wired (403 → `{ ok:false, status:'error' }`).
   */
  topUpCustomCredits: (credits: number) => Promise<PurchaseOutcome>;
}

export type BillingSlice = BillingSliceState & BillingActions;

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
