/**
 * Response-bound lifetime for a cluster-wide concurrency slot.
 *
 * Every long-lived byte stream this API serves (an artifact ZIP, a raw file, a
 * definition-folder export) holds a `concurrencySlot` for as long as it runs.
 * Binding that slot's release to a `finally` after `archive.finalize()` does not
 * hold: `finalize()` resolves when the last chunk is ACCEPTED by `res`, not
 * delivered, and on a client disconnect the archiver can be left undrained so it
 * never settles — pinning the slot for the whole TTL (M-NEW-027).
 *
 * One owner for that rule, shared by every streaming route.
 */

import type { Response } from 'express';

/**
 * A live stream re-arms its slot's TTL well before it lapses, so a legitimately
 * long download keeps COUNTING against the per-account budget instead of freeing
 * its own slot and letting the account re-admit past the limit. Interval ≪ TTL.
 */
const STREAM_SLOT_HEARTBEAT_MS = 5 * 60 * 1000;

/**
 * Backstop for a socket that neither delivers nor emits `close` (a wedged proxy):
 * past this the stream is torn down so its slot cannot be pinned indefinitely. Set
 * well above any legitimate large-archive-over-slow-link download.
 */
const STREAM_SLOT_MAX_LIFETIME_MS = 60 * 60 * 1000;

/**
 * Release the slot on `finish`/`close`/`error` (idempotent — every exit path is
 * covered), and heartbeat it while the stream is genuinely alive.
 */
export function bindStreamSlotToResponse(
  res: Response,
  slot: { release: () => Promise<void>; refresh: () => Promise<boolean> },
): void {
  let released = false;
  const startedAt = Date.now();
  const heartbeat = setInterval(() => {
    if (Date.now() - startedAt > STREAM_SLOT_MAX_LIFETIME_MS) {
      res.destroy();
      return;
    }
    void slot.refresh().then((alive) => {
      // The member was pruned (TTL lapsed and a concurrent reserve counted it
      // out): stop rather than run on past a budget we no longer hold.
      if (!alive) res.destroy();
    });
  }, STREAM_SLOT_HEARTBEAT_MS);
  const release = () => {
    if (released) return;
    released = true;
    clearInterval(heartbeat);
    void slot.release();
  };
  res.on('finish', release);
  res.on('close', release);
  res.on('error', release);
}
