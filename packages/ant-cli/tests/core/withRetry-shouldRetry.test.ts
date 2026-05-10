/**
 * Regression — `withRetry` with the `shouldRetry` override.
 *
 * Locks the new option that lets non-LLM consumers (e.g. baseProxy) supply
 * their own retry classifier without depending on the LLM-shaped error
 * matcher. baseProxy uses this to retry on transport errors only — upstream
 * 5xx responses (which fetch returns, never throws) flow through verbatim.
 */

import { describe, it, expect } from 'vitest';
import { withRetry } from '../../src/core/utils/retry';

describe('withRetry — shouldRetry override', () => {
  it('uses the shouldRetry predicate exclusively when provided (LLM classifier ignored)', async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          // Generic non-LLM error that the default classifier would NOT retry
          throw Object.assign(new Error('ECONNREFUSED 127.0.0.1:3000'), { code: 'ECONNREFUSED' });
        }
        return 'ok';
      },
      {
        maxAttempts: 5,
        initialDelayMs: 1,
        maxDelayMs: 5,
        shouldRetry: (err) => /econnrefused/i.test((err as Error).message),
      }
    );

    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('does not retry when shouldRetry returns false', async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw new Error('non-retryable');
        },
        {
          maxAttempts: 5,
          initialDelayMs: 1,
          maxDelayMs: 5,
          shouldRetry: () => false,
        }
      )
    ).rejects.toThrow(/non-retryable/);
    expect(attempts).toBe(1);
  });

  it('throws after maxAttempts when shouldRetry is always true', async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw new Error('always retryable');
        },
        {
          maxAttempts: 4,
          initialDelayMs: 1,
          maxDelayMs: 5,
          shouldRetry: () => true,
        }
      )
    ).rejects.toThrow(/always retryable/);
    expect(attempts).toBe(4);
  });
});
