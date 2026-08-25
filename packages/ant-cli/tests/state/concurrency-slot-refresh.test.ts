/**
 * ConcurrencySlot.refresh() — the heartbeat a long-lived holder needs so its
 * TTL does not lapse mid-stream and let the same account re-admit past the limit
 * (M-NEW-027). The slot keeps its member private, so refresh must go THROUGH the
 * handle; refreshSlot reports whether the member still existed (XX add), which
 * the caller uses to stop rather than run on past a budget it no longer counts.
 */

import { describe, it, expect } from 'vitest';
import { acquireConcurrencySlot } from '../../src/core/redis/concurrencySlot';

/** Redis-faithful slot set: reserve prunes+counts+adds; refresh is XX (no resurrect). */
class SlotStore {
  slots = new Map<string, Map<string, number>>();
  async reserveSlot(setKey: string, member: string, limit: number, ttlSeconds: number): Promise<boolean> {
    const now = Date.now();
    const set = this.slots.get(setKey) ?? new Map<string, number>();
    this.slots.set(setKey, set);
    for (const [m, exp] of set) if (exp <= now) set.delete(m);
    if (!set.has(member) && set.size >= limit) return false;
    set.set(member, now + ttlSeconds * 1000);
    return true;
  }
  async refreshSlot(setKey: string, member: string, ttlSeconds: number): Promise<boolean> {
    const set = this.slots.get(setKey);
    if (!set || !set.has(member)) return false; // XX miss — expired/released
    set.set(member, Date.now() + ttlSeconds * 1000);
    return true;
  }
  async releaseSlot(setKey: string, member: string): Promise<void> {
    this.slots.get(setKey)?.delete(member);
  }
  /** Test helper: drop the member as an expiry+prune would. */
  evict(setKey: string) { this.slots.get(setKey)?.clear(); }
}

const KEY = 'ant:slots:zip:org:u';

describe('ConcurrencySlot.refresh (M-NEW-027)', () => {
  it('refresh() extends a live slot → true', async () => {
    const store = new SlotStore() as any;
    const slot = await acquireConcurrencySlot(store, KEY, { limit: 2, ttlSeconds: 900 });
    expect(slot).not.toBeNull();
    expect(await slot!.refresh()).toBe(true);
  });

  it('refresh() on an expired/evicted member → false (caller must stop)', async () => {
    const store = new SlotStore();
    const slot = await acquireConcurrencySlot(store as any, KEY, { limit: 2, ttlSeconds: 900 });
    store.evict(KEY); // TTL lapsed and a concurrent reserve pruned it
    expect(await slot!.refresh()).toBe(false);
  });

  it('refresh() after release() → false (never re-arms a released slot)', async () => {
    const store = new SlotStore();
    const slot = await acquireConcurrencySlot(store as any, KEY, { limit: 2, ttlSeconds: 900 });
    await slot!.release();
    expect(await slot!.refresh()).toBe(false);
  });

  it('a Redis-failure fail-open slot refreshes true (nothing real to re-arm)', async () => {
    const throwing = {
      async reserveSlot() { throw new Error('redis down'); },
      async refreshSlot() { throw new Error('redis down'); },
      async releaseSlot() {},
    } as any;
    const slot = await acquireConcurrencySlot(throwing, KEY, { limit: 2, ttlSeconds: 900 });
    expect(slot).not.toBeNull(); // fail-open admit
    expect(await slot!.refresh()).toBe(true);
  });
});
