import type { BalanceSnapshot, CreditTransaction, SubscriptionTier } from '@ant/shared';
import type { CreditLedgerPort, ReserveResult, SettleArgs } from '../../../core/ports/creditLedger';

/**
 * No-op `CreditLedgerPort` used when `ANT_BILLING_ENABLED=false` (OSS / local).
 *
 * Contract:
 *   - `getBalance()` reports a free-tier, zero-balance snapshot so the FE — if
 *     it ever calls — renders coherently (it normally hides billing entirely).
 *   - `reserve()` always succeeds (billing never blocks a job).
 *   - `settle/releaseHold/topUp/changeTier/cancelSubscription` are no-ops.
 *   - `listTransactions()` → `[]`.
 *
 * Logs a single notice on first construction (mirrors `NoopMemoryAdapter`).
 * See `core/config/billingCapability.ts` for the SSOT toggle.
 */
export class NoopCreditLedger implements CreditLedgerPort {
  private static announced = false;

  constructor() {
    if (!NoopCreditLedger.announced) {
      console.log(
        'ℹ️  [Billing] Disabled (ANT_BILLING_ENABLED=false) — using no-op CreditLedger. ' +
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
