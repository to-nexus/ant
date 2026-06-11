import type { BalanceSnapshot, CreditTransaction, SubscriptionTier } from '@ant/shared';
import type { CreditLedgerPort, ReserveResult, SettleArgs } from '../../../core/ports/creditLedger';

/**
 * No-op `CreditLedgerPort` — the dormant fallback the billing seam selects when
 * `isBillingEnabled()` is false. Billing is always-on at this stage, so this is
 * currently unused; it is retained for the future `@ant/cloud` extraction (an
 * OSS build without the cloud package falls back to this no-op).
 *
 * Contract:
 *   - `getBalance()` reports a free-tier, zero-balance snapshot.
 *   - `reserve()` always succeeds (billing never blocks a job).
 *   - `settle/releaseHold/topUp/changeTier/cancelSubscription` are no-ops.
 *   - `listTransactions()` → `[]`.
 */
export class NoopCreditLedger implements CreditLedgerPort {
  private static announced = false;

  constructor() {
    if (!NoopCreditLedger.announced) {
      console.log(
        'ℹ️  [Billing] Using no-op CreditLedger (billing surface unavailable). ' +
          'No metering, no charges; balance reads as free/0.',
      );
      NoopCreditLedger.announced = true;
    }
  }

  private freeSnapshot(): BalanceSnapshot {
    return {
      tier: 'free',
      microCredits: 0,
      credits: 0,
      includedCreditsMonthly: 0,
      status: 'none',
    };
  }

  async getBalance(): Promise<BalanceSnapshot> {
    return this.freeSnapshot();
  }

  async reserve(
    _jobId: string,
    _orgId: string,
    _userId: string,
    microCredits: number,
  ): Promise<ReserveResult> {
    return { ok: true, balanceMicro: 0, requiredMicro: microCredits };
  }

  async releaseHold(_jobId: string): Promise<void> {
    // intentional no-op
  }

  async settle(_args: SettleArgs): Promise<void> {
    // intentional no-op
  }

  async topUp(): Promise<void> {
    // intentional no-op
  }

  async listTransactions(): Promise<CreditTransaction[]> {
    return [];
  }

  async changeTier(
    _orgId: string,
    _userId: string,
    _tier: SubscriptionTier,
    _opts: { providerRef?: string; idempotencyKey: string },
  ): Promise<BalanceSnapshot> {
    return this.freeSnapshot();
  }

  async cancelSubscription(): Promise<BalanceSnapshot> {
    return this.freeSnapshot();
  }
}
