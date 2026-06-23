/**
 * Billing slice TYPES (OSS-resident, type-only).
 *
 * The runtime `createBillingSlice` lives in `@ant/cloud/ui` (loaded only when
 * `VITE_INCLUDE_CLOUD`). These interfaces stay in OSS so the store's `Store` /
 * `StoreState` types can compose the billing shape without importing the
 * runtime slice. In an OSS build the slice is simply absent at runtime —
 * neutral readers guard every billing field/action with optional chaining
 * (see `kanbanReducer` / `KanbanHeader` / `useJobExecution`).
 */

import type { AsyncFields } from '@/domain/async';
import type { BalanceSnapshot, BillingCatalog, SubscriptionTier } from '@ant/shared';
import type { CreditTransaction, PaymentMethodInput, PurchaseOutcome } from '@ant/shared';

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
