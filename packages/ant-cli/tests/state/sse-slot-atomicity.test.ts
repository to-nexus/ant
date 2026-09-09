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

import { EventEmitter } from 'events';

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

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


/**
 * Slot lifetime is the JOB's, not the client socket's.
 *
 * A workflow stream carries exactly one job's events, so once that job ends it
 * can never carry another. Nothing closed it: `closeWorkflowClients` had zero
 * call sites, the FE's `end` listener only routed a message, and the 10s
 * heartbeat re-armed the slot's 30s TTL forever — so every completed job leaked
 * one slot from a per-account budget of 10 that workflow and feature streams
 * share. Universal makes a fresh job per turn, so ~10 turns spent the budget and
 * the next feature stream was refused 429 `connection_limit`.
 */
describe('SSEService — a finished job returns its workflow slot', () => {
  let store: SlotStore;
  let sse: SSEService;

  /** Minimal Response: `end()` fires 'close', which is what releases the slot. */
  function fakeRes(): any {
    const res: any = new EventEmitter();
    res.writableEnded = false;
    res.write = () => true;
    res.end = () => {
      if (res.writableEnded) return;
      res.writableEnded = true;
      res.emit('close');
    };
    return res;
  }

  beforeEach(async () => {
    store = new SlotStore();
    // This axis is about the close grace, not the subscribe window the cases
    // above cover — a timer-backed subscribe would just deadlock fake timers.
    store.subscribe = async (channel: string) => {
      store.subscribeCalls.push(channel);
      return () => {};
    };
    sse = new SSEService();
    await sse.setupBroadcastSubscriptions(store as any);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function admitWorkflow(jobId: string) {
    const admission = await sse.admitConnection(USER);
    if (!admission.ok) throw new Error('expected admission');
    const res = fakeRes();
    sse.registerWorkflowClient(jobId, res, admission.reservation);
    return res;
  }

  it('releases the slot when the job ends', async () => {
    await admitWorkflow('job-1');
    expect(await store.countSlots('ant:sse:slots:org1:u1')).toBe(1);

    sse.sendWorkflowEndEvent('job-1');
    await vi.runOnlyPendingTimersAsync();

    expect(await store.countSlots('ant:sse:slots:org1:u1')).toBe(0);
  });

  it('does not accumulate across successive jobs — the budget survives 15 turns', async () => {
    for (let i = 0; i < 15; i++) {
      await admitWorkflow(`job-${i}`);
      sse.sendWorkflowEndEvent(`job-${i}`);
      await vi.runOnlyPendingTimersAsync();
    }

    expect(await store.countSlots('ant:sse:slots:org1:u1')).toBe(0);
    expect((await sse.admitConnection(USER)).ok).toBe(true);
  });

  it('ends only the finished job\'s streams', async () => {
    await admitWorkflow('job-1');
    await admitWorkflow('job-2');

    sse.sendWorkflowEndEvent('job-1');
    await vi.runOnlyPendingTimersAsync();

    expect(await store.countSlots('ant:sse:slots:org1:u1')).toBe(1);
  });

  it('shutdown releases workflow slots explicitly, not via a listener racing exit', async () => {
    // The point of the fix is that release does NOT depend on the 'close'
    // listener running — on shutdown `res.end()` is fire-and-forget and races
    // `process.exit(0)`. So these responses never emit 'close': if `closeAll`
    // only ended them, the slots would survive to their TTL and every
    // reconnecting client would meet a budget that is still full.
    for (const jobId of ['job-1', 'job-2']) {
      const admission = await sse.admitConnection(USER);
      if (!admission.ok) throw new Error('expected admission');
      const res: any = new EventEmitter();
      res.write = () => true;
      res.end = () => {};
      sse.registerWorkflowClient(jobId, res, admission.reservation);
    }
    expect(await store.countSlots('ant:sse:slots:org1:u1')).toBe(2);

    await sse.closeAll();

    expect(await store.countSlots('ant:sse:slots:org1:u1')).toBe(0);
  });
});
