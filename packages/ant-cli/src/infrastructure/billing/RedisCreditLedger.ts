/**
 * RedisCreditLedger — Redis-backed credit balance + transaction ledger.
 *
 * Uses the raw ioredis client (same pattern as RedisOrganizationRepository) for
 * atomic INCRBY/DECRBY and LIST ops. Per the Unified Distributed System
 * Principle there is NO in-memory fallback — construction requires a live
 * Redis client.
 *
 * Keys (see REDIS_KEYS.BILLING):
 *   BALANCE  integer micro-credits (INCRBY/DECRBY)
 *   HELD     per-user aggregate of in-flight holds (micro)
 *   HOLD     per-job hold record {org,user,micro} (TTL'd, idempotent release)
 *   ACCOUNT  JSON BillingAccount (tier + grant cycle + markup)
 *   LEDGER   JSON-per-entry LIST, newest appended, LTRIM-capped
 */

import type { Redis } from 'ioredis';
import {
  type BalanceSnapshot,
  type BillingAccount,
  type CreditTransaction,
  type SubscriptionTier,
  TIER_DEFINITIONS,
  MARKUP_DEFAULT,
  usdToMicroCredits,
  creditsToMicroCredits,
  microCreditsToCredits,
} from '@ant/shared';
import type { CreditLedgerPort, ReserveResult, SettleArgs } from '../../core/ports/creditLedger';
import { REDIS_KEYS, REDIS_TTL } from '../../core/constants/redis';
import { logger } from '../../utils/logger';

const COMPONENT = 'RedisCreditLedger';
/** Long TTL for "durable" billing keys, refreshed on every access. */
const DURABLE_TTL = 365 * 24 * 60 * 60;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export class RedisCreditLedger implements CreditLedgerPort {
  constructor(private readonly redis: Redis) {
    if (!redis) {
      throw new Error(`[${COMPONENT}] requires a Redis client — no in-memory fallback.`);
    }
  }

  // ── account ──────────────────────────────────────────────────────────

  private async getOrCreateAccount(orgId: string, userId: string): Promise<BillingAccount> {
    const key = REDIS_KEYS.BILLING.ACCOUNT(orgId, userId);
    const raw = await this.redis.get(key);
    if (raw) {
      try {
        return JSON.parse(raw) as BillingAccount;
      } catch {
        /* fall through to recreate */
      }
    }
    const account: BillingAccount = {
      orgId,
      userId,
      tier: 'free',
      grantCycleAnchor: new Date().toISOString(),
      markup: MARKUP_DEFAULT,
      createdAt: new Date().toISOString(),
    };
    await this.redis.set(key, JSON.stringify(account), 'EX', DURABLE_TTL);
    // Seed the first monthly grant immediately so a brand-new account is usable.
    await this.applyGrant(orgId, userId, account.tier, 'initial grant');
    return account;
  }

  private async saveAccount(account: BillingAccount): Promise<void> {
    await this.redis.set(
      REDIS_KEYS.BILLING.ACCOUNT(account.orgId, account.userId),
      JSON.stringify(account),
      'EX',
      DURABLE_TTL,
    );
  }

  private async applyGrant(
    orgId: string,
    userId: string,
    tier: SubscriptionTier,
    note: string,
  ): Promise<void> {
    const credits = TIER_DEFINITIONS[tier].includedCreditsMonthly;
    const micro = creditsToMicroCredits(credits);
    await this.adjustBalance(orgId, userId, micro);
    await this.appendTransaction(orgId, userId, {
      id: randomId('grant'),
      ts: new Date().toISOString(),
      kind: 'grant',
      microCredits: micro,
      note,
    });
  }

  // ── balance ──────────────────────────────────────────────────────────

  private balanceKey(orgId: string, userId: string): string {
    return REDIS_KEYS.BILLING.BALANCE(orgId, userId);
  }

  private async readBalanceMicro(orgId: string, userId: string): Promise<number> {
    const raw = await this.redis.get(this.balanceKey(orgId, userId));
    return raw ? parseInt(raw, 10) || 0 : 0;
  }

  /** Atomic INCRBY (negative delta decrements). Refreshes the durable TTL. */
  private async adjustBalance(orgId: string, userId: string, deltaMicro: number): Promise<number> {
    const key = this.balanceKey(orgId, userId);
    const next = await this.redis.incrby(key, deltaMicro);
    await this.redis.expire(key, DURABLE_TTL);
    return next;
  }

  async getBalance(orgId: string, userId: string): Promise<BalanceSnapshot> {
    const account = await this.getOrCreateAccount(orgId, userId);

    // Lazy monthly grant (grant-on-read under a lock — no cron).
    const anchor = Date.parse(account.grantCycleAnchor);
    if (Number.isFinite(anchor) && Date.now() - anchor >= MONTH_MS) {
      const lockKey = REDIS_KEYS.BILLING.GRANT_LOCK(orgId, userId);
      const acquired = await this.redis.set(lockKey, '1', 'EX', 60, 'NX');
      if (acquired) {
        try {
          // Re-read to avoid double-granting if another node just granted.
          const fresh = await this.getOrCreateAccountRaw(orgId, userId);
          const freshAnchor = Date.parse(fresh.grantCycleAnchor);
          if (Number.isFinite(freshAnchor) && Date.now() - freshAnchor >= MONTH_MS) {
            await this.applyGrant(orgId, userId, fresh.tier, 'monthly grant');
            fresh.grantCycleAnchor = new Date().toISOString();
            await this.saveAccount(fresh);
          }
        } finally {
          await this.redis.del(lockKey);
        }
      }
    }

    const micro = await this.readBalanceMicro(orgId, userId);
    return {
      tier: account.tier,
      microCredits: micro,
      credits: microCreditsToCredits(micro),
      includedCreditsMonthly: TIER_DEFINITIONS[account.tier].includedCreditsMonthly,
    };
  }

  /** Account read WITHOUT the create-side seed grant (used inside the grant lock). */
  private async getOrCreateAccountRaw(orgId: string, userId: string): Promise<BillingAccount> {
    const raw = await this.redis.get(REDIS_KEYS.BILLING.ACCOUNT(orgId, userId));
    if (raw) {
      try {
        return JSON.parse(raw) as BillingAccount;
      } catch {
        /* recreate below */
      }
    }
    const account: BillingAccount = {
      orgId,
      userId,
      tier: 'free',
      grantCycleAnchor: new Date().toISOString(),
      markup: MARKUP_DEFAULT,
      createdAt: new Date().toISOString(),
    };
    await this.saveAccount(account);
    return account;
  }

  // ── reserve / hold ───────────────────────────────────────────────────

  async reserve(
    jobId: string,
    orgId: string,
    userId: string,
    microCredits: number,
  ): Promise<ReserveResult> {
    const holdKey = REDIS_KEYS.BILLING.HOLD(jobId);
    const heldKey = REDIS_KEYS.BILLING.HELD(orgId, userId);

    // Idempotent: if this job already holds, treat as success without
    // double-incrementing the aggregate.
    const existing = await this.redis.get(holdKey);
    if (existing) {
      const balanceMicro = await this.readBalanceMicro(orgId, userId);
      return { ok: true, balanceMicro, requiredMicro: microCredits };
    }

    // Ensure the account exists (seeds the first grant for new users).
    await this.getBalance(orgId, userId);

    const balanceMicro = await this.readBalanceMicro(orgId, userId);
    const heldMicro = parseInt((await this.redis.get(heldKey)) || '0', 10) || 0;
    const requiredMicro = heldMicro + microCredits;

    if (balanceMicro < requiredMicro) {
      return { ok: false, balanceMicro, requiredMicro };
    }

    await this.redis.set(
      holdKey,
      JSON.stringify({ orgId, userId, micro: microCredits }),
      'EX',
      REDIS_TTL.BILLING.HOLD,
    );
    await this.redis.incrby(heldKey, microCredits);
    await this.redis.expire(heldKey, DURABLE_TTL);
    return { ok: true, balanceMicro, requiredMicro };
  }

  async releaseHold(jobId: string): Promise<void> {
    const holdKey = REDIS_KEYS.BILLING.HOLD(jobId);
    const raw = await this.redis.get(holdKey);
    if (!raw) return; // already released / never held
    // DEL first so a concurrent release can't decrement twice.
    const removed = await this.redis.del(holdKey);
    if (removed === 0) return;
    try {
      const { orgId, userId, micro } = JSON.parse(raw) as {
        orgId: string;
        userId: string;
        micro: number;
      };
      if (micro > 0) {
        const heldKey = REDIS_KEYS.BILLING.HELD(orgId, userId);
        const next = await this.redis.decrby(heldKey, micro);
        if (next < 0) await this.redis.set(heldKey, '0'); // clamp drift
      }
    } catch (err) {
      logger.warn(`releaseHold parse failed for ${jobId}`, { component: COMPONENT }, err);
    }
  }

  // ── settle (debit) ───────────────────────────────────────────────────

  async settle(args: SettleArgs): Promise<void> {
    const { jobId, orgId, userId, usdCost, modelBreakdown, projectId, featureName, note } = args;

    // Idempotency: claim the per-job debit lock. A re-delivered completion
    // cannot double-charge.
    const lockKey = REDIS_KEYS.BILLING.DEBIT_LOCK(jobId);
    const acquired = await this.redis.set(lockKey, '1', 'EX', REDIS_TTL.BILLING.DEBIT_LOCK, 'NX');
    if (!acquired) {
      logger.debug(`settle skipped — already settled (jobId=${jobId})`, { component: COMPONENT });
      return;
    }

    const account = await this.getOrCreateAccount(orgId, userId);
    const microToDebit = usdToMicroCredits(usdCost, account.markup);

    if (microToDebit > 0) {
      // Debit, clamping the balance at 0 — billing never blocks a job, so an
      // overspend (actual > available) simply floors the balance instead of
      // going negative. No reservation/hold is taken (blocking is disabled).
      const next = await this.adjustBalance(orgId, userId, -microToDebit);
      if (next < 0) await this.redis.set(this.balanceKey(orgId, userId), '0');
    }
    await this.appendTransaction(orgId, userId, {
      id: randomId('debit'),
      ts: new Date().toISOString(),
      kind: 'debit',
      microCredits: -microToDebit,
      usdCost,
      ...(modelBreakdown && { modelBreakdown }),
      jobId,
      ...(projectId && { projectId }),
      ...(featureName && { featureName }),
      ...(note && { note }),
    });
  }

  // ── top-up ───────────────────────────────────────────────────────────

  async topUp(
    orgId: string,
    userId: string,
    credits: number,
    idempotencyKey: string,
  ): Promise<void> {
    // Dedupe retried purchases.
    const dedupeKey = `${REDIS_KEYS.BILLING.ACCOUNT(orgId, userId)}:topup:${idempotencyKey}`;
    const first = await this.redis.set(dedupeKey, '1', 'EX', DURABLE_TTL, 'NX');
    if (!first) {
      logger.debug(`topUp deduped (key=${idempotencyKey})`, { component: COMPONENT });
      return;
    }
    await this.getOrCreateAccount(orgId, userId);
    const micro = creditsToMicroCredits(credits);
    await this.adjustBalance(orgId, userId, micro);
    await this.appendTransaction(orgId, userId, {
      id: randomId('topup'),
      ts: new Date().toISOString(),
      kind: 'topup',
      microCredits: micro,
      note: `top-up ${credits} credits`,
    });
  }

  // ── ledger ───────────────────────────────────────────────────────────

  private async appendTransaction(
    orgId: string,
    userId: string,
    tx: CreditTransaction,
  ): Promise<void> {
    const key = REDIS_KEYS.BILLING.LEDGER(orgId, userId);
    await this.redis.rpush(key, JSON.stringify(tx));
    await this.redis.ltrim(key, -REDIS_TTL.BILLING.LEDGER_MAX_ENTRIES, -1);
    await this.redis.expire(key, DURABLE_TTL);
  }

  async listTransactions(
    orgId: string,
    userId: string,
    limit: number,
  ): Promise<CreditTransaction[]> {
    const key = REDIS_KEYS.BILLING.LEDGER(orgId, userId);
    const n = Math.max(1, Math.min(limit, REDIS_TTL.BILLING.LEDGER_MAX_ENTRIES));
    const raw = await this.redis.lrange(key, -n, -1);
    const txs = raw
      .map((s) => {
        try {
          return JSON.parse(s) as CreditTransaction;
        } catch {
          return null;
        }
      })
      .filter((t): t is CreditTransaction => t !== null);
    return txs.reverse(); // newest first
  }
}
