/**
 * `sandy-loading-coral` regression — idle-watchdog abort path must not deadlock.
 *
 * A silently stalled stream leaves the generator chain suspended at an
 * INTERNAL await (SSE bytes), not at a yield. Async-generator semantics queue
 * `iterator.return()` behind the pending `next()`, so the old catch path
 * (`await iterator.return()`) never settled, `throw err` was unreachable,
 * withRetryStream saw no error, and the design worker wedged forever while
 * checkpoints kept flowing. The fix releases the iterator without awaiting
 * and (via streamAttemptWithIdleAbort) severs the transport with a
 * per-attempt AbortController.
 */

import { describe, it, expect, vi } from 'vitest';
import { withStreamIdleTimeout, streamAttemptWithIdleAbort } from '../../src/core/utils/retry';
import { runInWorkerScope } from '../../src/core/parallel/workerScope';
import { abortWorkerStreamAttempts } from '../../src/core/parallel/streamAttemptRegistry';

/** Generator suspended at an internal never-resolving await — the exact
 *  incident shape: pending next(), return() queued behind it forever. */
async function* stuckAtInternalAwait(): AsyncGenerator<number> {
  await new Promise(() => {});
  yield 1;
}

async function consume<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of iterable) out.push(v);
  return out;
}

describe('withStreamIdleTimeout — abandoned-iterator deadlock', () => {
  it('rejects with the retryable idle error instead of hanging (incident regression)', async () => {
    // Pre-fix this await never settles and the test times out.
    await expect(consume(withStreamIdleTimeout(stuckAtInternalAwait(), 50))).rejects.toMatchObject({
      _isStreamIdleTimeout: true,
    });
  });

  it('invokes onIdleTimeout exactly once, before the throw', async () => {
    const onIdleTimeout = vi.fn();
    await expect(
      consume(withStreamIdleTimeout(stuckAtInternalAwait(), 50, onIdleTimeout)),
    ).rejects.toMatchObject({ _isStreamIdleTimeout: true });
    expect(onIdleTimeout).toHaveBeenCalledTimes(1);
  });

  it('does NOT invoke onIdleTimeout on normal completion', async () => {
    const onIdleTimeout = vi.fn();
    async function* ok(): AsyncGenerator<number> {
      yield 1;
      yield 2;
    }
    await expect(consume(withStreamIdleTimeout(ok(), 1000, onIdleTimeout))).resolves.toEqual([1, 2]);
    expect(onIdleTimeout).not.toHaveBeenCalled();
  });

  it('does NOT invoke onIdleTimeout when the source throws an ordinary error', async () => {
    const onIdleTimeout = vi.fn();
    async function* boom(): AsyncGenerator<number> {
      yield 1;
      throw new Error('api exploded');
    }
    await expect(consume(withStreamIdleTimeout(boom(), 1000, onIdleTimeout))).rejects.toThrow('api exploded');
    expect(onIdleTimeout).not.toHaveBeenCalled();
  });
});

describe('streamAttemptWithIdleAbort — transport severing', () => {
  it('watchdog aborts the per-attempt signal; consumer sees the retryable idle error', async () => {
    let seenSignal: AbortSignal | undefined;
    // SDK simulation: next() pends until the signal aborts, then rejects.
    async function* sdkLike(signal: AbortSignal): AsyncGenerator<number> {
      seenSignal = signal;
      await new Promise((_, reject) => {
        if (signal.aborted) return reject(signal.reason);
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
      yield 1;
    }
    await expect(
      consume(streamAttemptWithIdleAbort((signal) => sdkLike(signal), 50)),
    ).rejects.toMatchObject({ _isStreamIdleTimeout: true });
    expect(seenSignal?.aborted).toBe(true);
  });

  it('caller signal abort rejects promptly with the abort error (no idle timeout involved)', async () => {
    const caller = new AbortController();
    async function* sdkLike(signal: AbortSignal): AsyncGenerator<number> {
      await new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('user stop')), { once: true });
      });
      yield 1;
    }
    const pending = consume(
      streamAttemptWithIdleAbort((signal) => sdkLike(signal), 60_000, caller.signal),
    );
    caller.abort();
    await expect(pending).rejects.toThrow('user stop');
  });

  it('registers the attempt under the worker scope so the stall watchdog can sever it', async () => {
    await runInWorkerScope(7, async () => {
      async function* sdkLike(signal: AbortSignal): AsyncGenerator<number> {
        await new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
        yield 1;
      }
      const pending = consume(
        // Long idle window — only the registry abort can end this attempt.
        streamAttemptWithIdleAbort((signal) => sdkLike(signal), 60_000),
      );
      // Give the generator a tick to start and register.
      await new Promise((r) => setImmediate(r));
      const severed = abortWorkerStreamAttempts(7, new Error('stall watchdog'));
      expect(severed).toBe(1);
      await expect(pending).rejects.toThrow('stall watchdog');
      // Attempt unregistered after settling.
      expect(abortWorkerStreamAttempts(7, new Error('again'))).toBe(0);
    });
  });
});
