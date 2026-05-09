/**
 * `@ant/auth-client.fetchAuthMeDetailed` — discriminated `/auth/me` outcomes.
 *
 * Each branch maps to a distinct deployment misconfiguration; collapsing
 * any of them to `null` (as ant-site's pre-unification `fetchSessionUser`
 * did) loses the diagnostic distinction between "stale cookie" / "server
 * misconfigured" / "network down" / "shape drift" — the trap that hid the
 * original logout regression.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchAuthMeDetailed } from '@ant/auth-client';

const API_BASE = 'http://example.test/api';

describe('fetchAuthMeDetailed — 5-mode discriminated result', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('200 + valid user → kind=user', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          user: {
            email: 'a@b.c',
            userId: 'u1',
            organization: 'org1',
            name: 'Alice',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as any;
    const result = await fetchAuthMeDetailed({ apiBase: API_BASE });
    expect(result.kind).toBe('user');
    if (result.kind === 'user') {
      expect(result.user.email).toBe('a@b.c');
      expect(result.user.organization).toBe('org1');
    }
  });

  it('200 + {user: null} → kind=no-session', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ user: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as any;
    const result = await fetchAuthMeDetailed({ apiBase: API_BASE });
    expect(result.kind).toBe('no-session');
  });

  it('503 → kind=misconfigured', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('jwt secret missing', { status: 503 }),
    ) as any;
    const result = await fetchAuthMeDetailed({ apiBase: API_BASE });
    expect(result.kind).toBe('misconfigured');
  });

  it('500 → kind=http-error with status', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('boom', { status: 500 }),
    ) as any;
    const result = await fetchAuthMeDetailed({ apiBase: API_BASE });
    expect(result.kind).toBe('http-error');
    if (result.kind === 'http-error') expect(result.status).toBe(500);
  });

  it('fetch throws → kind=network', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as any;
    const result = await fetchAuthMeDetailed({ apiBase: API_BASE });
    expect(result.kind).toBe('network');
    if (result.kind === 'network') expect(result.message).toMatch(/ECONNREFUSED/);
  });

  it('200 + bad shape → kind=shape', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: 'no user field' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as any;
    const result = await fetchAuthMeDetailed({ apiBase: API_BASE });
    expect(result.kind).toBe('shape');
  });

  it('200 + user missing required fields → kind=shape', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ user: { email: 'a@b.c' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as any;
    const result = await fetchAuthMeDetailed({ apiBase: API_BASE });
    expect(result.kind).toBe('shape');
  });
});
