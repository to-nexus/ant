/**
 * RedisCreditLedger behavior — seed grant, 0-floor debit, idempotent settle.
 *
 * Uses a minimal in-memory Redis fake implementing only the ops the ledger
 * calls. Locks the "billing never blocks → overspend floors at 0, never
 * negative" invariant and double-settle idempotency.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RedisCreditLedger } from '../../src/infrastructure/billing/RedisCreditLedger';
import { TIER_DEFINITIONS } from '../../src/infrastructure/billing/catalog';
import { creditsToMicroCredits } from '@ant/shared';
import { REDIS_KEYS } from '../../src/core/constants/redis';

/** In-memory Redis supporting the subset RedisCreditLedger uses. */
class FakeRedis {
  store = new Map<string, string>();
  lists = new Map<string, string[]>();

  async get(key: string): Promise<string | null> {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  async set(key: string, val: string, ..._args: any[]): Promise<string | null> {
    const nx = _args.includes('NX');
    if (nx && this.store.has(key)) return null;
    this.store.set(key, val);
    return 'OK';
  }
  async incrby(key: string, n: number): Promise<number> {
    const next = (parseInt(this.store.get(key) ?? '0', 10) || 0) + n;
    this.store.set(key, String(next));
    return next;
  }
  async decrby(key: string, n: number): Promise<number> {
    return this.incrby(key, -n);
  }
  async expire(): Promise<number> { return 1; }
  async del(key: string): Promise<number> {
    const had = this.store.delete(key) || this.lists.delete(key);
    return had ? 1 : 0;
  }
  async rpush(key: string, val: string): Promise<number> {
    const arr = this.lists.get(key) ?? [];
    arr.push(val);
    this.lists.set(key, arr);
    return arr.length;
  }
  async ltrim(key: string, start: number, end: number): Promise<string> {
    const arr = this.lists.get(key) ?? [];
    this.lists.set(key, arr.slice(start, end === -1 ? undefined : end + 1));
    return 'OK';
  }
  async lrange(key: string, start: number, end: number): Promise<string[]> {
    const arr = this.lists.get(key) ?? [];
    return arr.slice(start < 0 ? Math.max(0, arr.length + start) : start, end === -1 ? undefined : end + 1);
  }
}

const ORG = 'individual';
const USER = 'a@b.com';

describe('RedisCreditLedger', () => {
  let redis: FakeRedis;
  let ledger: RedisCreditLedger;

  beforeEach(() => {
    redis = new FakeRedis();
    ledger = new RedisCreditLedger(redis as any);
  });

  it('seeds a free-tier grant on first balance read', async () => {
    const snap = await ledger.getBalance(ORG, USER);
    expect(snap.tier).toBe('free');
    expect(snap.credits).toBe(TIER_DEFINITIONS.free.includedCreditsMonthly);
  });

  it('debits actual cost from the balance', async () => {
    await ledger.getBalance(ORG, USER); // seed 200
    await ledger.settle({ jobId: 'j1', orgId: ORG, userId: USER, usdCost: 0.01 }); // $0.01 × 1.75 = 1.75 credits
    const snap = await ledger.getBalance(ORG, USER);
    expect(snap.credits).toBeLessThan(TIER_DEFINITIONS.free.includedCreditsMonthly);
    expect(snap.credits).toBeGreaterThan(0);
  });

  it('floors the balance at 0 on overspend (never negative — billing does not block)', async () => {
    await ledger.getBalance(ORG, USER); // seed 200
    await ledger.settle({ jobId: 'big', orgId: ORG, userId: USER, usdCost: 1000 }); // way over balance
    const snap = await ledger.getBalance(ORG, USER);
    expect(snap.credits).toBe(0);
    expect(snap.microCredits).toBe(0);
  });

  it('is idempotent per jobId (re-delivered completion does not double-charge)', async () => {
    await ledger.getBalance(ORG, USER);
    await ledger.settle({ jobId: 'dup', orgId: ORG, userId: USER, usdCost: 0.02 });
    const after1 = (await ledger.getBalance(ORG, USER)).microCredits;
    await ledger.settle({ jobId: 'dup', orgId: ORG, userId: USER, usdCost: 0.02 }); // same jobId
    const after2 = (await ledger.getBalance(ORG, USER)).microCredits;
    expect(after2).toBe(after1);
  });

  it('top-up adds credits and appends a ledger row', async () => {
    await ledger.getBalance(ORG, USER);
    await ledger.topUp(ORG, USER, 500, 'key-1');
    const snap = await ledger.getBalance(ORG, USER);
    expect(snap.microCredits).toBe(creditsToMicroCredits(TIER_DEFINITIONS.free.includedCreditsMonthly + 500));
    const txs = await ledger.listTransactions(ORG, USER, 50);
    expect(txs.some((t) => t.kind === 'topup')).toBe(true);
  });

  it('changeTier sets the tier active and grants the new allotment immediately', async () => {
    await ledger.getBalance(ORG, USER); // seed free 200
    const snap = await ledger.changeTier(ORG, USER, 'pro', { idempotencyKey: 'sub-1', providerRef: 'mock' });
    expect(snap.tier).toBe('pro');
    expect(snap.status).toBe('active');
    expect(snap.currentPlanId).toBe('pro');
    expect(snap.credits).toBe(
      TIER_DEFINITIONS.free.includedCreditsMonthly + TIER_DEFINITIONS.pro.includedCreditsMonthly,
    );
    const txs = await ledger.listTransactions(ORG, USER, 50);
    expect(txs.some((t) => t.kind === 'subscription')).toBe(true);
  });

  it('changeTier is idempotent per idempotencyKey (no double grant)', async () => {
    await ledger.getBalance(ORG, USER);
    const first = await ledger.changeTier(ORG, USER, 'pro', { idempotencyKey: 'same' });
    const second = await ledger.changeTier(ORG, USER, 'pro', { idempotencyKey: 'same' });
    expect(second.microCredits).toBe(first.microCredits);
  });

  it('cancelSubscription flags canceled but keeps the paid tier + balance (cycle-end)', async () => {
    await ledger.getBalance(ORG, USER);
    await ledger.changeTier(ORG, USER, 'pro', { idempotencyKey: 'sub-1' });
    const before = (await ledger.getBalance(ORG, USER)).microCredits;
    const snap = await ledger.cancelSubscription(ORG, USER);
    expect(snap.status).toBe('canceled');
    expect(snap.tier).toBe('pro'); // stays until cycle end
    expect(snap.microCredits).toBe(before); // no clawback
  });

  it('migrates legacy tier vocabulary on read (starter→pro, gated by schemaVersion)', async () => {
    // Seed a legacy account (pre-rename): tier 'starter', no schemaVersion.
    const key = REDIS_KEYS.BILLING.ACCOUNT(ORG, USER);
    redis.store.set(
      key,
      JSON.stringify({ orgId: ORG, userId: USER, tier: 'starter', grantCycleAnchor: new Date().toISOString(), markup: 1.75, createdAt: new Date().toISOString() }),
    );
    const snap = await ledger.getBalance(ORG, USER);
    expect(snap.tier).toBe('pro'); // starter → pro
    // Persisted with the current schema version so the migration is one-time.
    const stored = JSON.parse(redis.store.get(key)!);
    expect(stored.schemaVersion).toBe(2);
    expect(stored.tier).toBe('pro');
  });

  it('migrates legacy pro→max (old $100 tier becomes max)', async () => {
    const key = REDIS_KEYS.BILLING.ACCOUNT(ORG, 'legacy@b.com');
    redis.store.set(
      key,
      JSON.stringify({ orgId: ORG, userId: 'legacy@b.com', tier: 'pro', grantCycleAnchor: new Date().toISOString(), markup: 1.75, createdAt: new Date().toISOString() }),
    );
    const snap = await ledger.getBalance(ORG, 'legacy@b.com');
    expect(snap.tier).toBe('max');
  });
});
