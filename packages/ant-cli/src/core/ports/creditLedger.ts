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

import type { BalanceSnapshot, CreditTransaction } from '@ant/shared';

export interface ReserveResult {
  ok: boolean;
  /** Current balance in micro-credits at decision time. */
  balanceMicro: number;
  /** Micro-credits required (existing holds + this reservation). */
  requiredMicro: number;
}

export interface SettleArgs {
  jobId: string;
  orgId: string;
  userId: string;
  /** Precise internal USD list cost (from per-model pricing). */
  usdCost: number;
  /** Per-model USD breakdown (operator/admin display). */
  modelBreakdown?: Record<string, number>;
  projectId?: string;
  featureName?: string;
  /** Optional note (e.g. unknown-model fallback). */
  note?: string;
}

export interface CreditLedgerPort {
  /** Read balance + tier, applying any due monthly grant lazily. */
  getBalance(orgId: string, userId: string): Promise<BalanceSnapshot>;

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
}
