/**
 * StubPaymentProvider — no real payment gateway.
 *
 * Credits the ledger directly on top-up (idempotent via the ledger's dedupe
 * key) and treats subscription changes as no-op successes. Swapping in a real
 * provider later is a new adapter; callers are unchanged.
 */

import type {
  PaymentProviderPort,
  TopUpRequest,
  TopUpResult,
} from '../../core/ports/paymentProvider';
import type { CreditLedgerPort } from '../../core/ports/creditLedger';
import { logger } from '../../utils/logger';

const COMPONENT = 'StubPaymentProvider';

export class StubPaymentProvider implements PaymentProviderPort {
  constructor(private readonly ledger: CreditLedgerPort) {}

  async topUp(req: TopUpRequest): Promise<TopUpResult> {
    if (req.credits <= 0) {
      return { ok: false, reason: 'credits must be positive' };
    }
    await this.ledger.topUp(req.orgId, req.userId, req.credits, req.idempotencyKey);
    logger.info(
      `stub top-up: +${req.credits} credits for ${req.orgId}:${req.userId}`,
      { component: COMPONENT },
    );
    return { ok: true, transactionId: `stub_${req.idempotencyKey}` };
  }

  async startSubscription(orgId: string, userId: string, tier: string): Promise<{ ok: boolean }> {
    logger.info(`stub startSubscription: ${orgId}:${userId} → ${tier}`, { component: COMPONENT });
    return { ok: true };
  }

  async cancelSubscription(orgId: string, userId: string): Promise<{ ok: boolean }> {
    logger.info(`stub cancelSubscription: ${orgId}:${userId}`, { component: COMPONENT });
    return { ok: true };
  }
}
