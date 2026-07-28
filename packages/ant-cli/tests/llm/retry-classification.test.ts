/**
 * Retry classification — transport-error hardening (sandy-loading-coral 2nd RCA).
 *
 * undici dispatcher timeouts surface two ways:
 *  - raw fetch: TypeError('fetch failed') with cause carrying UND_ERR_* —
 *    retryable via the existing TypeError branch;
 *  - wrapped by the SDKs: APIConnectionError('Connection error.') — previously
 *    matched NO branch (not a TypeError, no .error.type, no .status) and was
 *    silently non-retryable. Locked here: cause-chain walk + wrapper name.
 * Balance depletion must stay a fast-fail regardless of wrapper shape.
 */

import { describe, it, expect } from 'vitest';
import { isRetryableError } from '../../src/core/utils/retry';

const RETRYABLE = ['overloaded_error', 'api_error'];

function undiciTimeout(code: string): Error {
  return Object.assign(new Error('Body Timeout Error'), { code, name: 'BodyTimeoutError' });
}

describe('isRetryableError — transport cause chain', () => {
  it('raw fetch TypeError with UND_ERR cause stays retryable (existing branch)', () => {
    const err = Object.assign(new TypeError('fetch failed'), {
      cause: undiciTimeout('UND_ERR_BODY_TIMEOUT'),
    });
    expect(isRetryableError(err, RETRYABLE)).toBe(true);
  });

  it('SDK-wrapped APIConnectionError with a nested UND_ERR cause is retryable (the hole)', () => {
    const wrapper = Object.assign(new Error('Connection error.'), {
      name: 'APIConnectionError',
      cause: Object.assign(new TypeError('fetch failed'), {
        cause: undiciTimeout('UND_ERR_HEADERS_TIMEOUT'),
      }),
    });
    expect(isRetryableError(wrapper, RETRYABLE)).toBe(true);
  });

  it('bare APIConnectionError without a cause chain is still retryable (connection-class)', () => {
    const wrapper = Object.assign(new Error('Connection error.'), { name: 'APIConnectionError' });
    expect(isRetryableError(wrapper, RETRYABLE)).toBe(true);
  });

  it('ECONNRESET / UND_ERR_SOCKET codes anywhere in the chain are retryable', () => {
    const reset = Object.assign(new Error('socket hang up'), {
      cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
    });
    expect(isRetryableError(reset, RETRYABLE)).toBe(true);
    const sock = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' });
    expect(isRetryableError(sock, RETRYABLE)).toBe(true);
  });

  it('cause-chain walk is bounded — a self-referential cause cannot loop forever', () => {
    const cyclic: any = new Error('weird');
    cyclic.cause = cyclic;
    expect(isRetryableError(cyclic, RETRYABLE)).toBe(false);
  });

  it('provider balance depletion stays non-retryable even under a connection-looking wrapper', () => {
    const err = Object.assign(new Error('Insufficient balance or no resource package. Please recharge.'), {
      name: 'APIConnectionError',
      status: 429,
    });
    expect(isRetryableError(err, RETRYABLE)).toBe(false);
  });

  it('unrelated plain errors remain non-retryable', () => {
    expect(isRetryableError(new Error('validation failed'), RETRYABLE)).toBe(false);
  });
});
