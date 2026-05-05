/**
 * Distributed Lock SSOT
 *
 * Cross-process mutual exclusion via Redis `SET key value NX EX ttl`.
 * Acquire returns null on contention; release uses Lua compare-and-DEL
 * so the TTL-then-reacquire race never deletes someone else's lock.
 *
 * Used by:
 *   - `RemoteService.withLock` — clone / init / fetch single-flight
 *   - `tryAcquireThrottle` — same SETNX semantics, no release (TTL is
 *     the window). e.g. cloud-ide start's worktree-prune throttle.
 */

import { randomUUID } from 'crypto';
import * as os from 'os';
import type { StateStorePort } from '../ports/stateStore';

export interface DistributedLock {
  /** The key the caller acquired. */
  readonly key: string;
  /** Compare-and-delete if this holder still owns the key. Idempotent. */
  release(): Promise<void>;
}

/**
 * Try to acquire `key` with a fresh per-attempt token. Returns:
 *   - `DistributedLock` when acquired (owner can call `release()`).
 *   - `null` when another caller holds it.
 *
 * Throws on Redis transport error — caller decides whether to surface
 * (clone / init / fetch propagate; throttle skips silently).
 */
export async function acquireLock(
  stateStore: StateStorePort,
  key: string,
  ttlSec: number,
): Promise<DistributedLock | null> {
  const value = `${os.hostname()}:${process.pid}:${randomUUID()}`;
  const ok = await stateStore.tryAcquireLock(key, value, ttlSec);
  if (!ok) return null;
  return {
    key,
    release: () => stateStore.releaseLockIfOwner(key, value),
  };
}

/**
 * Throttle gate — returns `true` exactly once per TTL window. Subsequent
 * calls within the window return `false` and the caller skips its work.
 *
 * No release: the TTL is the gate. Failed-Redis throws bubble up; the
 * caller decides whether to skip (preferred) or fail loud.
 */
export async function tryAcquireThrottle(
  stateStore: StateStorePort,
  key: string,
  ttlSec: number,
): Promise<boolean> {
  const value = `${os.hostname()}:${process.pid}:${Date.now()}`;
  return stateStore.tryAcquireLock(key, value, ttlSec);
}
