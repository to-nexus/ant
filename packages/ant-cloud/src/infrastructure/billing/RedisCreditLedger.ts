/**
 * RedisCreditLedger — Redis-backed credit balance + transaction ledger.
 *
 * Uses the raw ioredis client (same pattern as RedisOrganizationRepository) for
 * atomic INCRBY/DECRBY and LIST ops. Per the Unified Distributed System
 * Principle there is NO in-memory fallback — construction requires a live
 * Redis client.
 *
 * Cloud-designated (commercial). Imports the resale catalog from the BE-local
 * `catalog.ts` SSOT (markup magnitude, plan allotments) — never from @ant/shared.
 *
 * Keys (see REDIS_KEYS.BILLING):
 *   BALANCE  integer micro-credits (INCRBY/DECRBY)
 *   HELD     per-user aggregate of in-flight holds (micro)
 *   HOLD     per-job hold record {org,user,micro} (TTL'd, idempotent release)
 *   ACCOUNT  JSON BillingAccount (tier + grant cycle + markup + subscription)
 *   LEDGER   JSON-per-entry LIST, newest appended, LTRIM-capped
 */

import type { Redis } from 'ioredis';
import {
  type BalanceSnapshot,
  type BillingAccount,
  type CreditTransaction,
  type CreditTransactionKind,
  type SubscriptionTier,
  BILLING_SCHEMA_VERSION,
  normalizeTier,
  usdToMicroCredits,
  creditsToMicroCredits,
  microCreditsToCredits,
} from '@ant/shared';
import { MARKUP_DEFAULT, includedCreditsFor } from './catalog';
import type {
  CreditLedgerPort,
  DebitCumulativeArgs,
  ReserveResult,
  SettleArgs,
} from '../../../../ant-cli/src/core/ports/creditLedger';
import { REDIS_KEYS, REDIS_TTL } from '../../../../ant-cli/src/core/constants/redis';
import { logger } from '../../../../ant-cli/src/utils/logger';

const COMPONENT = 'RedisCreditLedger';
/** Long TTL for "durable" billing keys, refreshed on every access. */
const DURABLE_TTL = 365 * 24 * 60 * 60;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Atomic monotonic cumulative-debit. KEYS[1]=balance, KEYS[2]=charged.
 * ARGV[1]=target micro, ARGV[2]=charged TTL, ARGV[3]=balance durable TTL.
 * Raises `charged` toward `target` and debits only the positive delta,
 * clamping the balance at 0 (billing floors, never goes negative). Returns
 * {delta, newBalance}. Idempotent: a target ≤ charged is a no-op.
 */
const DEBIT_CUMULATIVE_LUA = `
local charged = tonumber(redis.call('GET', KEYS[2]) or '0')
local target = tonumber(ARGV[1])
if target > charged then
  local delta = target - charged
  local nb = redis.call('INCRBY', KEYS[1], -delta)
  if nb < 0 then redis.call('SET', KEYS[1], '0'); nb = 0 end
  redis.call('SET', KEYS[2], tostring(target))
  redis.call('EXPIRE', KEYS[1], ARGV[3])
  redis.call('EXPIRE', KEYS[2], ARGV[2])
  return {delta, nb}
end
local nb = tonumber(redis.call('GET', KEYS[1]) or '0')
return {0, nb}
`;

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

  /**
   * Parse a stored account, applying the one-time tier-vocabulary migration
   * (`free/starter/pro → free/pro/max`) when `schemaVersion < 2`. Returns the
   * account plus whether it was mutated (so the caller persists once).
   */
  private migrate(raw: BillingAccount): { account: BillingAccount; changed: boolean } {
    const legacy = (raw.schemaVersion ?? 0) < BILLING_SCHEMA_VERSION;
    if (!legacy) return { account: raw, changed: false };
    const account: BillingAccount = {
      ...raw,
      tier: normalizeTier(raw.tier, true),
      ...(raw.currentPlanId && { currentPlanId: normalizeTier(raw.currentPlanId, true) }),
      schemaVersion: BILLING_SCHEMA_VERSION,
    };
    return { account, changed: true };
  }

  private newAccount(orgId: string, userId: string): BillingAccount {
    const now = new Date().toISOString();
    return {
      orgId,
      userId,
      tier: 'free',
      grantCycleAnchor: now,
      markup: MARKUP_DEFAULT,
      createdAt: now,
      schemaVersion: BILLING_SCHEMA_VERSION,
      status: 'none',
    };
  }

  private async getOrCreateAccount(orgId: string, userId: string): Promise<BillingAccount> {
    const key = REDIS_KEYS.BILLING.ACCOUNT(orgId, userId);
    const raw = await this.redis.get(key);
    if (raw) {
      try {
        const { account, changed } = this.migrate(JSON.parse(raw) as BillingAccount);
        if (changed) await this.saveAccount(account);
        return account;
      } catch {
        /* fall through to recreate */
      }
    }
    const account = this.newAccount(orgId, userId);
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
    kind: CreditTransactionKind = 'grant',
  ): Promise<void> {
    const credits = includedCreditsFor(tier);
    const micro = creditsToMicroCredits(credits);
    if (micro <= 0) return;
    await this.adjustBalance(orgId, userId, micro);
    await this.appendTransaction(orgId, userId, {
      id: randomId(kind),
      ts: new Date().toISOString(),
      kind,
      microCredits: micro,
      note,
    });
  }

  private snapshot(account: BillingAccount, micro: number): BalanceSnapshot {
    const anchor = Date.parse(account.grantCycleAnchor);
    const nextBillingDate = Number.isFinite(anchor)
      ? new Date(anchor + MONTH_MS).toISOString()
      : undefined;
    return {
      tier: account.tier,
      microCredits: micro,
      credits: microCreditsToCredits(micro),
      includedCreditsMonthly: includedCreditsFor(account.tier),
      status: account.status ?? 'none',
      ...(account.currentPlanId && { currentPlanId: account.currentPlanId }),
      ...(nextBillingDate && { nextBillingDate }),
      markup: account.markup,
    };
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
    let account = await this.getOrCreateAccount(orgId, userId);

    // Lazy monthly grant (grant-on-read under a lock — no cron). A pending
    // cycle-end cancellation reverts the tier to free at this boundary.
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
            if (fresh.status === 'canceled') {
              // Cycle-end downgrade: paid plan lapses to free, then grant free.
              fresh.tier = 'free';
              fresh.currentPlanId = undefined;
              fresh.status = 'none';
              fresh.canceledAt = undefined;
            }
            await this.applyGrant(orgId, userId, fresh.tier, 'monthly grant');
            fresh.grantCycleAnchor = new Date().toISOString();
            await this.saveAccount(fresh);
            account = fresh;
          }
        } finally {
          await this.redis.del(lockKey);
        }
      }
    }

    const micro = await this.readBalanceMicro(orgId, userId);
    return this.snapshot(account, micro);
  }

  /** Account read WITHOUT the create-side seed grant (used inside the grant lock). */
  private async getOrCreateAccountRaw(orgId: string, userId: string): Promise<BillingAccount> {
    const raw = await this.redis.get(REDIS_KEYS.BILLING.ACCOUNT(orgId, userId));
    if (raw) {
      try {
        const { account, changed } = this.migrate(JSON.parse(raw) as BillingAccount);
        if (changed) await this.saveAccount(account);
        return account;
      } catch {
        /* recreate below */
      }
    }
    const account = this.newAccount(orgId, userId);
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

  // ── cumulative debit (incremental metering + terminal settle) ──────────

  async debitToCumulative(args: DebitCumulativeArgs): Promise<BalanceSnapshot> {
    const { jobId, orgId, userId, cumulativeUsd } = args;
    const account = await this.getOrCreateAccount(orgId, userId);
    const targetMicro = usdToMicroCredits(cumulativeUsd, account.markup);

    const balanceKey = this.balanceKey(orgId, userId);
    const res = (await this.redis.eval(
      DEBIT_CUMULATIVE_LUA,
      2,
      balanceKey,
      REDIS_KEYS.BILLING.CHARGED(jobId),
      String(Math.max(0, Math.round(targetMicro))),
      String(REDIS_TTL.BILLING.CHARGED),
      String(DURABLE_TTL),
    )) as [number, number];
    return this.snapshot(account, res[1]);
  }

  // ── settle (terminal debit) ────────────────────────────────────────────

  async settle(args: SettleArgs): Promise<void> {
    const { jobId, orgId, userId, usdCost, modelBreakdown, projectId, featureName, note } = args;

    // Idempotency for the LEDGER ROW: claim the per-job debit lock so a
    // re-delivered completion cannot write a second row. The balance move
    // itself is already idempotent (monotonic `charged`).
    const lockKey = REDIS_KEYS.BILLING.DEBIT_LOCK(jobId);
    const acquired = await this.redis.set(lockKey, '1', 'EX', REDIS_TTL.BILLING.DEBIT_LOCK, 'NX');
    if (!acquired) {
      logger.debug(`settle skipped — already settled (jobId=${jobId})`, { component: COMPONENT });
      return;
    }

    const account = await this.getOrCreateAccount(orgId, userId);
    const microToDebit = usdToMicroCredits(usdCost, account.markup);

    // Move the balance to the final cumulative target (captures any delta the
    // live meter has not yet charged). Atomic + monotonic — overlap with a
    // late live tick is a no-op, not a double charge.
    await this.debitToCumulative({ jobId, orgId, userId, cumulativeUsd: usdCost });

    // One coalesced `debit` row recording the full job cost + per-model split.
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

  // ── subscription ──────────────────────────────────────────────────────

  async changeTier(
    orgId: string,
    userId: string,
    tier: SubscriptionTier,
    opts: { providerRef?: string; idempotencyKey: string },
  ): Promise<BalanceSnapshot> {
    const accountKey = REDIS_KEYS.BILLING.ACCOUNT(orgId, userId);
    const dedupeKey = `${accountKey}:tierChange:${opts.idempotencyKey}`;
    const first = await this.redis.set(dedupeKey, '1', 'EX', DURABLE_TTL, 'NX');

    const account = await this.getOrCreateAccount(orgId, userId);
    if (!first) {
      // Retried change — already applied. Return the current balance.
      const micro = await this.readBalanceMicro(orgId, userId);
      return this.snapshot(account, micro);
    }

    const now = new Date();
    account.tier = tier;
    account.currentPlanId = tier;
    account.status = 'active';
    account.subscribedAt = now.toISOString();
    account.canceledAt = undefined;
    if (opts.providerRef) account.providerRef = opts.providerRef;
    account.schemaVersion = BILLING_SCHEMA_VERSION;
    // A plan change starts a fresh cycle.
    account.grantCycleAnchor = now.toISOString();
    await this.saveAccount(account);

    // Immediate grant of the new tier's allotment, guarded per-anchor so
    // upgrade↔downgrade churn within one fresh cycle can't farm grants.
    const grantMarker = `${accountKey}:planGrant:${Date.parse(account.grantCycleAnchor)}`;
    const grantFirst = await this.redis.set(grantMarker, '1', 'EX', DURABLE_TTL, 'NX');
    if (grantFirst) {
      await this.applyGrant(orgId, userId, tier, `plan ${tier}`, 'subscription');
    }

    const micro = await this.readBalanceMicro(orgId, userId);
    return this.snapshot(account, micro);
  }

  async cancelSubscription(orgId: string, userId: string): Promise<BalanceSnapshot> {
    const account = await this.getOrCreateAccount(orgId, userId);
    if (account.status === 'active' && account.tier !== 'free') {
      // Cycle-end: keep the paid tier until the next grant boundary, which
      // reverts to free (see getBalance). No clawback.
      account.status = 'canceled';
      account.canceledAt = new Date().toISOString();
      await this.saveAccount(account);
    }
    const micro = await this.readBalanceMicro(orgId, userId);
    return this.snapshot(account, micro);
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
