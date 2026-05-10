/**
 * Regression — `waitForHttpReady` polling contract.
 *
 * Locks the SSOT helper extracted from IDEService for K8s reuse:
 *   - returns immediately when upstream responds with status < 500
 *   - retries on transport errors (no listening server) until timeout
 *   - throws after timeout
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { waitForHttpReady } from '../../src/infrastructure/ide/readiness';

describe('waitForHttpReady', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns immediately when upstream responds with status < 500', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 })
    );

    await expect(waitForHttpReady('127.0.0.1', 3000, '/ide/x/', 5_000)).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('treats 401/302 as ready (server is alive and routing)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 401 })
    );

    await expect(waitForHttpReady('127.0.0.1', 3000, '/', 5_000)).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps polling on transport errors and succeeds when upstream comes up', async () => {
    let calls = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      calls += 1;
      if (calls < 3) {
        throw new TypeError('fetch failed');
      }
      return new Response(null, { status: 200 });
    });

    await expect(waitForHttpReady('127.0.0.1', 3000, '/', 5_000)).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('throws after timeout when upstream never responds < 500', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new TypeError('fetch failed');
    });

    await expect(waitForHttpReady('127.0.0.1', 3000, '/', 800)).rejects.toThrow(/HTTP endpoint not ready/);
  });

  it('keeps polling on 5xx responses (server up but route not yet initialised)', async () => {
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      calls += 1;
      if (calls < 2) {
        return new Response(null, { status: 500 });
      }
      return new Response(null, { status: 200 });
    });

    await expect(waitForHttpReady('127.0.0.1', 3000, '/', 5_000)).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });
});
