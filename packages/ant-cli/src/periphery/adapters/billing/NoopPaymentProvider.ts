import type { PurchaseOutcome } from '@ant/shared';
import type {
  PaymentProviderPort,
  PurchaseRequest,
  SubscriptionOutcome,
} from '../../../core/ports/paymentProvider';

/**
 * No-op `PaymentProviderPort` used when `ANT_BILLING_ENABLED=false`.
 *
 * Every operation reports an error outcome — purchasing/subscribing is not a
 * feature in OSS / local. The billing routes are unregistered when disabled, so
 * this is only a defensive backstop; it never charges or grants.
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
