/**
 * jobAbort registry — process-scoped AbortController for the running job.
 *
 * Locks the contract relied on by the user-stop fix:
 *   - getJobAbortSignal() returns a live, non-aborted signal initially
 *   - abortJob() trips it (and isJobAborted reflects the transition)
 *   - abortJob() is idempotent (double-stop / STOP+SIGTERM cannot throw)
 *   - the same signal instance observes the abort (threaded into the LLM stream)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('jobAbort registry', () => {
  beforeEach(() => {
    vi.resetModules(); // fresh module-level controller per test
  });

  it('starts not aborted and exposes a stable signal', async () => {
    const { getJobAbortSignal, isJobAborted } = await import('../../src/composition/jobAbort');
    const signal = getJobAbortSignal();
    expect(isJobAborted()).toBe(false);
    expect(signal.aborted).toBe(false);
    // Stable instance — the signal handed to the LLM stream must be the one that trips.
    expect(getJobAbortSignal()).toBe(signal);
  });

  it('abortJob trips the signal and isJobAborted', async () => {
    const { getJobAbortSignal, abortJob, isJobAborted } = await import('../../src/composition/jobAbort');
    const signal = getJobAbortSignal();
    abortJob();
    expect(signal.aborted).toBe(true);
    expect(isJobAborted()).toBe(true);
  });

  it('abortJob is idempotent', async () => {
    const { abortJob, isJobAborted } = await import('../../src/composition/jobAbort');
    abortJob();
    expect(() => abortJob()).not.toThrow();
    expect(isJobAborted()).toBe(true);
  });
});
