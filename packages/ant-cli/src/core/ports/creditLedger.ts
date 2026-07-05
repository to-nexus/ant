/**
 * CreditLedgerPort
 *
 * Per-(org,user) credit balance + append-only transaction ledger. Backed by
 * Redis (RedisCreditLedger). Per the Unified Distributed System Principle the
 * adapter throws if the StateStore is absent — there is NO in-memory fallback.
 *
 * Lifecycle of a job's credits:
 *   1. reserve()      — pre-flight hold at enqueue (estimate-based floor).
 *   2. settle()       — debit ACTUAL cost on completion (idempotent), release hold.
 *   (failure)         — releaseHold() if the job never settles.
 *
 * The monthly included-credit grant is applied lazily inside getBalance()
 * (grant-on-read under a lock) so no cron is required.
 */

import type { BalanceSnapshot, CreditTransaction, SubscriptionTier } from '@ant/shared';

export interface ReserveResult {
  ok: boolean;
  /** Current balance in micro-credits at decision time. */
  balanceMicro: number;
  /** Micro-credits required (existing holds + this reservation). */
  requiredMicro: number;
}

/**
 * Neutral facts (no pricing) the OSS side passes so the CLOUD ledger can compute
 * the per-job platform fee from its catalog. LLM cost stays pass-through; the fee
 * is folded into the same cumulative debit. The fee magnitude lives ONLY in the
 * cloud catalog — nothing here encodes it.
 */
export interface PlatformFeeFacts {
  /** Job kind — indexes the fee base matrix (`code`/`plan`/`design`/…). */
  jobType: string;
  /** Execution tier 0..4 (code jobs only) — indexes the code base-matrix row. */
  executionTier?: number;
  /** Count of user-facing tasks (`isBillableWorkTask`) — drives the per-task fee. */
  billableTaskCount: number;
}

export interface SettleArgs extends PlatformFeeFacts {
  jobId: string;
  orgId: string;
  userId: string;
  /** Precise internal USD list cost — LLM pass-through (from per-model pricing). */
  usdCost: number;
  /** Per-model USD breakdown (operator/admin display). */
  modelBreakdown?: Record<string, number>;
  projectId?: string;
  featureName?: string;
  /** Optional note (e.g. unknown-model fallback). */
  note?: string;
}

export interface DebitCumulativeArgs extends PlatformFeeFacts {
  jobId: string;
  orgId: string;
  userId: string;
  /** Job-cumulative precise USD list cost so far (LLM pass-through). */
  cumulativeUsd: number;
  /** Per-model USD breakdown of the cumulative cost (operator/admin display). */
  modelBreakdown?: Record<string, number>;
  projectId?: string;
  featureName?: string;
  note?: string;
}

export interface CreditLedgerPort {
  /** Read balance + tier, applying any due monthly grant lazily. */
  getBalance(orgId: string, userId: string): Promise<BalanceSnapshot>;

  /**
   * Debit toward a job's CUMULATIVE cost. Idempotent + monotonic: tracks the
   * micro-credits already charged for `jobId` and debits only the positive
   * delta needed to reach `cumulativeUsd` (converted via the account markup).
   * Safe to call repeatedly during a job (live metering) AND once at terminal
   * settle — the read-charged → delta → debit → set-charged sequence is atomic
   * (single Lua script), so the live meter (child) and finalize (API process)
   * racing on the same job cannot double-charge. Returns the resulting balance.
   */
  debitToCumulative(args: DebitCumulativeArgs): Promise<BalanceSnapshot>;

  /**
   * Reserve a hold for an in-flight job. Returns `ok:false` (without writing a
   * hold) when balance < (sum of existing holds + this reservation).
   */
  reserve(
    jobId: string,
    orgId: string,
    userId: string,
    microCredits: number,
  ): Promise<ReserveResult>;

  /** Release a job's hold (job failed before settle, or post-settle cleanup). */
  releaseHold(jobId: string): Promise<void>;

  /**
   * Debit the ACTUAL cost on job completion. Idempotent per jobId (guarded by a
   * Redis lock) so a re-delivered completion cannot double-charge. Converts USD
   * → micro-credits via the account's markup, decrements the balance, appends a
   * `debit` ledger entry, and releases the job's hold.
   */
  settle(args: SettleArgs): Promise<void>;

  /**
   * Add purchased credits (called by the PaymentProvider after a successful
   * top-up). `idempotencyKey` dedupes retried purchases. Appends a `topup` row.
   */
  topUp(
    orgId: string,
    userId: string,
    credits: number,
    idempotencyKey: string,
  ): Promise<void>;

  /** Recent transactions, newest first. */
  listTransactions(orgId: string, userId: string, limit: number): Promise<CreditTransaction[]>;

  /**
   * Change the subscription tier and grant the new tier's included credits
   * immediately (fresh cycle). Idempotent per `idempotencyKey`. Used by the
   * subscribe route after a successful charge. Returns the fresh balance.
   */
  changeTier(
    orgId: string,
    userId: string,
    tier: SubscriptionTier,
    opts: { providerRef?: string; idempotencyKey: string },
  ): Promise<BalanceSnapshot>;

  /**
   * Cancel the active subscription at cycle end: flags the account `canceled`
   * (tier stays until `nextBillingDate`, then reverts to `free` lazily on the
   * next grant boundary). Balance is never clawed back. Returns the balance.
   */
  cancelSubscription(orgId: string, userId: string): Promise<BalanceSnapshot>;
}
