/**
 * Submit-failure surface — one axis: what the user sees, and keeps, when a
 * chat submit fails.
 *
 * A cloud submit died at the transport layer (an ALB WAF answered 403 without
 * CORS headers, so the browser could only report `TypeError: Failed to fetch`)
 * and three things went wrong at once:
 *
 *   1. `client.ts` had no type for "no readable response" — `ApiError` only
 *      ever described a response that ARRIVED — so the raw browser string was
 *      what reached the modal.
 *   2. `useChatSubmit` announced a plain code-job start failure with
 *      `inlineAsk.failed`; the `defaultValue: 'Job failed to start'` beside it
 *      was unreachable because the key exists in both locales.
 *   3. Two of the three failure paths dropped the user's typed directive
 *      (thousands of characters, the only copy).
 *
 * Rows below cover the seam behaviourally and the three call sites statically —
 * the call-site defect is a missing argument / wrong key, which is what has to
 * be checked at the call site itself.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { authFetch, apiGet, apiPost, ApiError, NetworkError } from '../../src/infrastructure/http/api/client';
import { setOnTransportFailure, type TransportFailureInfo } from '../../src/infrastructure/http/transportFailure';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const SUBMIT = path.join(SRC, 'presentation/components/chat/hooks/useChatSubmit.ts');

describe('authFetch — transport failure has exactly one mint', () => {
  let notified: string[];
  let reported: Array<{ url: string; info: TransportFailureInfo }>;

  beforeEach(() => {
    notified = [];
    reported = [];
    setOnTransportFailure((url, info) => {
      notified.push(url);
      reported.push({ url, info });
    });
  });

  afterEach(() => {
    setOnTransportFailure(null);
    vi.unstubAllGlobals();
  });

  it('passes a real response through and notifies nobody', async () => {
    const response = new Response('{}', { status: 401 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    await expect(authFetch('https://api.test/api/health')).resolves.toBe(response);
    expect(notified).toEqual([]);
  });

  it('mints NetworkError and notifies once when fetch throws TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const error = await authFetch('https://api.test/api/x').catch((e) => e);

    expect(error).toBeInstanceOf(NetworkError);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(error.code).toBe('NETWORK_UNREACHABLE');
    expect(error.url).toBe('https://api.test/api/x');
    expect(notified).toEqual(['https://api.test/api/x']);
  });

  it('rethrows a non-TypeError (abort) untouched and notifies nobody', async () => {
    const abort = new DOMException('The user aborted a request.', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort));

    const error = await authFetch('https://api.test/api/x').catch((e) => e);

    expect(error).toBe(abort);
    expect(error).not.toBeInstanceOf(NetworkError);
    expect(notified).toEqual([]);
  });

  it('every apiPost caller inherits the mint (no second conversion site)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(apiPost('https://api.test/api/x', { a: 1 })).rejects.toBeInstanceOf(NetworkError);
  });

  /**
   * The consumer's verdict may not outrun what the mint observed. A bodyless
   * request cannot have been refused for its content, so `hasBody` travels with
   * the notification and the content-refusal reading is gated on it — the modal
   * used to tell a user mid project-switch to reword input they never typed.
   */
  it('reports a bodyless request as hasBody:false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await apiGet('https://api.test/api/projects/p/config').catch(() => {});

    expect(reported).toHaveLength(1);
    expect(reported[0].info).toEqual({ method: 'GET', hasBody: false });
  });

  it('reports a body-carrying request as hasBody:true with its method', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await apiPost('https://api.test/api/x', { a: 1 }).catch(() => {});

    expect(reported).toHaveLength(1);
    expect(reported[0].info).toEqual({ method: 'POST', hasBody: true });
  });
});

/**
 * `application/json` is not a CORS-safelisted `Content-Type`, so declaring it
 * makes a request non-simple and costs a preflight. Declaring it on bodyless
 * GETs bought one per call against a cross-origin API — and a refused preflight
 * is invisible to the `/health` probe, which is the one fetch we make that has
 * no headers at all.
 */
describe('authFetch — only a request with a body declares a Content-Type', () => {
  let seen: RequestInit | undefined;

  beforeEach(() => {
    seen = undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      seen = init;
      return new Response('{}', { status: 200 });
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const contentType = () => (seen?.headers as Record<string, string> | undefined)?.['Content-Type'];

  it('omits it on a bodyless GET', async () => {
    await authFetch('https://api.test/api/x');
    expect(contentType()).toBeUndefined();
  });

  it('sets it on a JSON body', async () => {
    await authFetch('https://api.test/api/x', { method: 'POST', body: JSON.stringify({ a: 1 }) });
    expect(contentType()).toBe('application/json');
  });

  it('omits it on FormData so the browser can set the multipart boundary', async () => {
    await authFetch('https://api.test/api/x', { method: 'POST', body: new FormData() });
    expect(contentType()).toBeUndefined();
  });

  it('lets an explicit caller header win', async () => {
    await authFetch('https://api.test/api/x', {
      method: 'POST', body: 'raw', headers: { 'Content-Type': 'text/plain' },
    });
    expect(contentType()).toBe('text/plain');
  });
});

describe('useChatSubmit — every failure path labels correctly and keeps the text', () => {
  const source = fs.readFileSync(SUBMIT, 'utf8');

  /** One helper owns label + restore + modal suppression; nothing bypasses it. */
  const CALLS = source.match(/surfaceSubmitFailure\('(inlineAsk|jobStart)\.failed'/g) ?? [];

  it('routes all three failure paths through the single surface', () => {
    expect(CALLS).toHaveLength(3);
  });

  it.each([
    ['inlineAsk.failed', 1],
    ['jobStart.failed', 2],
  ] as const)('uses %s at exactly %i call site(s)', (key, count) => {
    expect(CALLS.filter((c) => c.includes(key))).toHaveLength(count);
  });

  it('shows no error modal for a transport failure — the detector owns that surface', () => {
    expect(source).toMatch(/error instanceof NetworkError\)\s*return;/);
  });

  it('gives the typed directive back on every failure', () => {
    // The helper is the only `setMessage` on a failure path; asserting it here
    // is what makes the three call sites above sufficient.
    expect(source).toMatch(/const surfaceSubmitFailure[\s\S]{0,400}?setMessage\(typed\)/);
  });

  it('carries no unreachable defaultValue beside a key that exists', () => {
    expect(source).not.toMatch(/t\('(inlineAsk|jobStart)\.failed',\s*\{\s*defaultValue/);
  });
});
