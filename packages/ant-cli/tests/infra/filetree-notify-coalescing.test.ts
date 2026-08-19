/**
 * KeyedSingleFlight — the coalescing behind `notifyFileTreeUpdate`.
 *
 * Every mutating tool call and every artifact mutation API asks for a file-tree
 * refresh, and each refresh is a full recursive walk + Redis write + publish.
 * Without coalescing, a burst of N writes cost N walks producing near-identical
 * payloads (M-009). The mechanism was live on the API-server plane only, with
 * zero test coverage; it is now shared with the worker plane, so it gets one.
 *
 * The load-bearing property is that there is NO timer: the run's own duration is
 * the coalescing window. A scheduled-but-unstarted rerun would be invisible to a
 * shutdown flush and would silently drop the end-of-job broadcast.
 */

import { describe, it, expect, vi } from 'vitest';
import { KeyedSingleFlight } from '../../src/core/realtime/KeyedSingleFlight';

/** A promise plus its resolver, so a test controls exactly when a run settles. */
function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res as () => void;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let queued microtasks (the `.finally` chains) run. */
const tick = () => new Promise((r) => setImmediate(r));

describe('KeyedSingleFlight', () => {
  it('runs immediately when nothing is in flight', async () => {
    const flight = new KeyedSingleFlight();
    const fn = vi.fn(async () => {});
    await flight.run('k', fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(flight.inFlightCount).toBe(0);
  });

  it('joins the in-flight run instead of starting a second one', async () => {
    const flight = new KeyedSingleFlight();
    const d = deferred();
    const fn = vi.fn(() => d.promise);

    const a = flight.run('k', fn);
    const b = flight.run('k', fn);
    const c = flight.run('k', fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(flight.inFlightCount).toBe(1);

    d.resolve();
    await Promise.all([a, b, c]);
    await tick();
    // One trailing run for the requests that arrived mid-flight — coalescing,
    // not dropping: the last mutation must still be reflected.
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('runs exactly ONE trailing pass no matter how many arrive mid-flight', async () => {
    const flight = new KeyedSingleFlight();
    const first = deferred();
    let calls = 0;
    const fn = vi.fn(() => {
      calls += 1;
      return calls === 1 ? first.promise : Promise.resolve();
    });

    const a = flight.run('k', fn);
    for (let i = 0; i < 20; i++) void flight.run('k', fn);
    first.resolve();
    await a;
    await tick();
    // 20 coalesced requests → 2 runs total. Worst case per burst is 2.
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('starts a fresh run for a request arriving after the previous settled', async () => {
    const flight = new KeyedSingleFlight();
    const fn = vi.fn(async () => {});
    await flight.run('k', fn);
    await flight.run('k', fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('never coalesces across distinct keys', async () => {
    const flight = new KeyedSingleFlight();
    const d1 = deferred();
    const d2 = deferred();
    const fn1 = vi.fn(() => d1.promise);
    const fn2 = vi.fn(() => d2.promise);

    const a = flight.run('org:user:p1:f', fn1);
    const b = flight.run('org:user:p2:f', fn2);
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
    expect(flight.inFlightCount).toBe(2);

    d1.resolve();
    d2.resolve();
    await Promise.all([a, b]);
  });

  it('clears the key when the run rejects, so it cannot wedge permanently', async () => {
    const flight = new KeyedSingleFlight();
    const boom = vi.fn(() => Promise.reject(new Error('walk failed')));
    await expect(flight.run('k', boom)).rejects.toThrow('walk failed');
    expect(flight.inFlightCount).toBe(0);

    // A later request must still run — a transient failure must not disable
    // tree refreshes for the rest of the job.
    const ok = vi.fn(async () => {});
    await flight.run('k', ok);
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('reports the initial run AND the coalesced rerun through onRun', async () => {
    // This is the flush-on-close contract: the caller registers every run with
    // its InflightTracker, so `close()` waits for the trailing broadcast too.
    const seen: Promise<void>[] = [];
    const flight = new KeyedSingleFlight({ onRun: (p) => { seen.push(p); } });
    const d = deferred();
    let calls = 0;
    const fn = () => {
      calls += 1;
      return calls === 1 ? d.promise : Promise.resolve();
    };

    const a = flight.run('k', fn);
    void flight.run('k', fn);
    expect(seen).toHaveLength(1);

    d.resolve();
    await a;
    await tick();
    expect(seen).toHaveLength(2);
    await Promise.allSettled(seen);
  });

  it('has no timer — the run duration is the whole coalescing window', async () => {
    // Guards against reintroducing a debounce without a matching flushPending():
    // a scheduled-but-unstarted rerun is invisible to InflightTracker.flush(),
    // which silently drops the end-of-job broadcast.
    vi.useFakeTimers();
    try {
      const flight = new KeyedSingleFlight();
      const fn = vi.fn(async () => {});
      await flight.run('k', fn);
      // No pending timers were created by the flight itself.
      expect(vi.getTimerCount()).toBe(0);
      expect(fn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
