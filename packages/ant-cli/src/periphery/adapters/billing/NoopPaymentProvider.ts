import type { PurchaseOutcome } from '@ant/shared';
import type {
  PaymentProviderPort,
  PurchaseRequest,
  SubscriptionOutcome,
} from '../../../core/ports/paymentProvider';

/**
 * No-op `PaymentProviderPort` — what the billing seam selects when
 * `isBillingEnabled()` is false, i.e. every OSS build and local mode
 * (`InfrastructureFactory.getPaymentProvider`). Every operation reports an error
 * outcome — it never charges or grants; the real provider ships in `@ant/cloud`.
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
