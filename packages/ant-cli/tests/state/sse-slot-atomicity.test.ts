/**
 * SSE admission atomicity — one axis, one row per case (M-005).
 *
 * Two defects with one shape: a check that is not fused to the action it guards.
 *
 *   1. The per-account connection budget counted with `SCAN` and then reserved
 *      with `SETEX`. Eleven simultaneous opens each read a pre-limit count and
 *      each reserved, so a limit of 10 admitted 11.
 *   2. `subscribeToUserChannels` marked a channel subscribed AFTER awaiting the
 *      subscribe, so concurrent first connections each registered their own
 *      callback on the same Redis channel. Those callbacks are never removed, so
 *      one published event was processed once per duplicate.
 *
 * The store double here implements `reserveSlot` the way Redis does — prune,
 * count and add in one indivisible step — so the test measures the CALLER's
 * contract, not a reimplementation of Lua.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { SSEService } from '../../src/periphery/adapters/http/services/SSEService';

const USER = { organizationId: 'org1', userId: 'u1' } as any;

/** Atomic-by-construction slot set (single-threaded JS = one indivisible step). */
class SlotStore {
  slots = new Map<string, Map<string, number>>();
  subscribeCalls: string[] = [];
  subscribeDelayMs = 5;
  transportReady = true;

  isTransportReady() { return this.transportReady; }

  async reserveSlot(setKey: string, member: string, limit: number, ttlSeconds: number): Promise<boolean> {
    const now = Date.now();
    const set = this.slots.get(setKey) ?? new Map<string, number>();
    this.slots.set(setKey, set);
    for (const [m, exp] of set) if (exp <= now) set.delete(m);
    if (!set.has(member) && set.size >= limit) return false;
    set.set(member, now + ttlSeconds * 1000);
    return true;
  }

  async releaseSlot(setKey: string, member: string): Promise<void> {
    this.slots.get(setKey)?.delete(member);
  }

  async refreshSlot(setKey: string, member: string, ttlSeconds: number): Promise<void> {
    const set = this.slots.get(setKey);
    if (set?.has(member)) set.set(member, Date.now() + ttlSeconds * 1000);
  }

  async countSlots(setKey: string): Promise<number> {
    const now = Date.now();
    const set = this.slots.get(setKey);
    if (!set) return 0;
    return [...set.values()].filter(exp => exp > now).length;
  }

  // Subscribing is async, which is what created the duplicate-callback window.
  async subscribe(channel: string, _cb: (m: unknown) => void): Promise<() => void> {
    this.subscribeCalls.push(channel);
    await new Promise(r => setTimeout(r, this.subscribeDelayMs));
    return () => {};
  }

  // Unused by admitConnection but part of the port surface it may touch.
  async countKeysByPrefix() { return 0; }
  async setKeyWithTTL() {}
  async deleteKey() {}
  async expireKey() {}
}

describe('SSEService.admitConnection — per-account budget', () => {
  let store: SlotStore;
  let sse: SSEService;

  beforeEach(async () => {
    store = new SlotStore();
    sse = new SSEService();
    await sse.setupBroadcastSubscriptions(store as any);
  });

  it('admits exactly the limit when 11 connections race', async () => {
    const results = await Promise.all(Array.from({ length: 11 }, () => sse.admitConnection(USER)));
    const admitted = results.filter(r => r.ok);
    const refused = results.filter(r => !r.ok);

    expect(admitted).toHaveLength(10);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ ok: false, status: 429, code: 'connection_limit' });
    expect(await store.countSlots('ant:sse:slots:org1:u1')).toBe(10);
  });

  it('a released slot is reusable (a reconnect is not permanently penalised)', async () => {
    const first = await Promise.all(Array.from({ length: 10 }, () => sse.admitConnection(USER)));
    expect((await sse.admitConnection(USER)).ok).toBe(false);

    const held = first[0];
    if (!held.ok) throw new Error('expected admission');
    await store.releaseSlot(held.reservation.slotKey!, held.reservation.member!);

    expect((await sse.admitConnection(USER)).ok).toBe(true);
  });

  it('each admission gets its own member so releases do not collide', async () => {
    const results = await Promise.all(Array.from({ length: 3 }, () => sse.admitConnection(USER)));
    const members = results.map(r => (r.ok ? r.reservation.member : undefined));
    expect(new Set(members).size).toBe(3);
  });

  it('separate accounts have separate budgets', async () => {
    await Promise.all(Array.from({ length: 10 }, () => sse.admitConnection(USER)));
    const other = await sse.admitConnection({ organizationId: 'org1', userId: 'u2' } as any);
    expect(other.ok).toBe(true);
  });

  it('refuses when the transport is not ready, without reserving', async () => {
    store.transportReady = false;
    const result = await sse.admitConnection(USER);
    expect(result).toMatchObject({ ok: false, status: 503, code: 'transport_unavailable' });
    expect(await store.countSlots('ant:sse:slots:org1:u1')).toBe(0);
  });
});

describe('SSEService — per-account channel subscription is single-flight', () => {
  let store: SlotStore;
  let sse: SSEService;

  beforeEach(async () => {
    store = new SlotStore();
    sse = new SSEService();
    await sse.setupBroadcastSubscriptions(store as any);
  });

  it('registers each user channel exactly once across concurrent first connections', async () => {
    await Promise.all(Array.from({ length: 10 }, () => sse.admitConnection(USER)));

    const broadcast = store.subscribeCalls.filter(c => c.includes('broadcast'));
    const workflow = store.subscribeCalls.filter(c => c.includes('workflow'));
    expect(broadcast).toHaveLength(1);
    expect(workflow).toHaveLength(1);
  });

  it('subscribes once per account, not once per process', async () => {
    await Promise.all([
      sse.admitConnection(USER),
      sse.admitConnection({ organizationId: 'org1', userId: 'u2' } as any),
      sse.admitConnection(USER),
    ]);
    expect(store.subscribeCalls).toHaveLength(4); // 2 channels × 2 accounts
  });

  it('a later connection re-attempts after a failed subscribe', async () => {
    let failNext = true;
    store.subscribe = async (channel: string) => {
      store.subscribeCalls.push(channel);
      if (failNext) {
        failNext = false;
        throw new Error('redis down');
      }
      return () => {};
    };

    const first = await sse.admitConnection(USER);
    expect(first).toMatchObject({ ok: false, code: 'transport_unavailable' });
    // The failed memo must not be sticky, and the refused connection's slot must
    // have been released — otherwise a transient blip burns the budget.
    expect(await store.countSlots('ant:sse:slots:org1:u1')).toBe(0);

    const second = await sse.admitConnection(USER);
    expect(second.ok).toBe(true);
  });
});
