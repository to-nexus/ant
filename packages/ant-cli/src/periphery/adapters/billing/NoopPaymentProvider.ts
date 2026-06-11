import type { PurchaseOutcome } from '@ant/shared';
import type {
  PaymentProviderPort,
  PurchaseRequest,
  SubscriptionOutcome,
} from '../../../core/ports/paymentProvider';

/**
 * No-op `PaymentProviderPort` — the dormant fallback the billing seam selects
 * when `isBillingEnabled()` is false. Billing is always-on at this stage, so
 * this is currently unused; retained for the future `@ant/cloud` extraction.
 * Every operation reports an error outcome — it never charges or grants.
 */
export class NoopPaymentProvider implements PaymentProviderPort {
  async purchaseCredits(_req: PurchaseRequest): Promise<PurchaseOutcome> {
    return { ok: false, status: 'error', reason: 'billing disabled' };
  }

  async startSubscription(): Promise<SubscriptionOutcome> {
    return { ok: false, status: 'error', reason: 'billing disabled' };
  }

  async cancelSubscription(): Promise<SubscriptionOutcome> {
    return { ok: false, status: 'error', reason: 'billing disabled' };
  }
}
