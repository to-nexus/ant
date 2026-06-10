/**
 * RedisCreditLedger behavior — seed grant, 0-floor debit, idempotent settle.
 *
 * Uses a minimal in-memory Redis fake implementing only the ops the ledger
 * calls. Locks the "billing never blocks → overspend floors at 0, never
 * negative" invariant and double-settle idempotency.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RedisCreditLedger } from '../../src/infrastructure/billing/RedisCreditLedger';
import { TIER_DEFINITIONS, creditsToMicroCredits } from '@ant/shared';

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
});
