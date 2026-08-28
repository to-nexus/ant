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

import { authFetch, apiPost, ApiError, NetworkError } from '../../src/infrastructure/http/api/client';
import { setOnTransportFailure } from '../../src/infrastructure/http/transportFailure';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const SUBMIT = path.join(SRC, 'presentation/components/chat/hooks/useChatSubmit.ts');

describe('authFetch — transport failure has exactly one mint', () => {
  let notified: string[];

  beforeEach(() => {
    notified = [];
    setOnTransportFailure((url) => notified.push(url));
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
