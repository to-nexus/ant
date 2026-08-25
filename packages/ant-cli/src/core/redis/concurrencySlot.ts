/**
 * Cluster-wide in-flight semaphore.
 *
 * `distributedLock` bounds an operation to ONE holder. This bounds it to N, which
 * is what an expensive-but-legitimate request needs: a directory ZIP stream, a
 * recursive tree scan, a multipart upload being buffered. Ownership is not the
 * problem there — cost is. A single account can hold every one of those open in
 * parallel and saturate the pod's CPU, filesystem workers and sockets while every
 * per-request check still passes (M-007, H-008, M-009, M-NEW-004).
 *
 * Redis-backed rather than process-local: a `Map` bounds one pod, and the same
 * account's requests land on all of them.
 *
 * Built on `StateStorePort.reserveSlot`, so the count and the reservation are one
 * atomic step — a check-then-reserve semaphore does not hold under the very
 * concurrency it exists to bound.
 */

import { randomUUID } from 'crypto';
import * as os from 'os';

import type { StateStorePort } from '../ports/stateStore';
import { logger } from '../../utils/logger';

export interface ConcurrencySlot {
  /** Release the slot. Idempotent — safe to call from several teardown paths. */
  release(): Promise<void>;
  /**
   * Re-arm this slot's TTL so a legitimately long hold does not let the crash
   * backstop expire it — at which point the count drops and the same account
   * re-admits past the limit (M-NEW-027). Returns `false` when the member is
   * already gone (expired or released) so the caller can abort rather than run
   * on past the budget; `true` when the TTL was extended. The member id stays
   * private to the slot — callers heartbeat through this, never by rebuilding
   * `refreshSlot` arguments themselves.
   */
  refresh(): Promise<boolean>;
}

export interface ConcurrencySlotOptions {
  /** Max simultaneous holders. */
  limit: number;
  /**
   * Seconds after which an unreleased slot expires on its own. Must exceed the
   * longest legitimate hold, or a slow-but-valid request frees its own slot and
   * the limit stops holding. It is a crash backstop, not the release mechanism.
   */
  ttlSeconds: number;
}

/**
 * Try to take a slot. `null` means the budget is full — the caller answers 429
 * rather than queueing, so a flood is refused at the edge instead of piling up.
 *
 * A Redis failure resolves to a slot rather than a refusal: this is an
 * availability guard, and failing every expensive request closed on a transport
 * blip trades one availability problem for a worse one.
 */
export async function acquireConcurrencySlot(
  stateStore: StateStorePort,
  key: string,
  opts: ConcurrencySlotOptions,
): Promise<ConcurrencySlot | null> {
  const member = `${os.hostname()}:${process.pid}:${randomUUID()}`;

  let admitted: boolean;
  try {
    admitted = await stateStore.reserveSlot(key, member, opts.limit, opts.ttlSeconds);
  } catch (err) {
    logger.warn(
      `[concurrencySlot] reserve failed for ${key} — admitting without a slot`,
      { component: 'concurrencySlot' },
      err,
    );
    // No real reservation was taken (fail-open), so a refresh has nothing to
    // re-arm — report success so a heartbeat loop does not abort a request the
    // guard deliberately admitted.
    return { release: async () => {}, refresh: async () => true };
  }

  if (!admitted) return null;

  let released = false;
  return {
    release: async () => {
      if (released) return;
      released = true;
      try {
        await stateStore.releaseSlot(key, member);
      } catch (err) {
        // The TTL is the backstop; a lost release costs one slot for ttlSeconds.
        logger.warn(
          `[concurrencySlot] release failed for ${key}`,
          { component: 'concurrencySlot' },
          err,
        );
      }
    },
    refresh: async () => {
      if (released) return false;
      try {
        return await stateStore.refreshSlot(key, member, opts.ttlSeconds);
      } catch (err) {
        // Treat a transport blip as still-alive: the same fail-open rationale as
        // acquire. A genuinely expired member is reported by refreshSlot's XX
        // miss returning false, which is a real signal to stop.
        logger.warn(
          `[concurrencySlot] refresh failed for ${key} — treating slot as live`,
          { component: 'concurrencySlot' },
          err,
        );
        return true;
      }
    },
  };
}

/**
 * Run `fn` while holding a slot, releasing on every exit path.
 * Returns `null` without running `fn` when the budget is full.
 */
export async function withConcurrencySlot<T>(
  stateStore: StateStorePort,
  key: string,
  opts: ConcurrencySlotOptions,
  fn: () => Promise<T>,
): Promise<{ admitted: true; value: T } | { admitted: false }> {
  const slot = await acquireConcurrencySlot(stateStore, key, opts);
  if (!slot) return { admitted: false };
  try {
    return { admitted: true, value: await fn() };
  } finally {
    await slot.release();
  }
}
