/**
 * Cookie domain derivation — `JwtService` resolves the `Domain` attribute
 * from `(COOKIE_DOMAIN env, request hostname)` so a single split-host
 * deployment can issue one cookie that spans `*.crosstoken.io`
 * (ant-server / ant-preview / ant) without requiring a vault env var.
 *
 * Contract:
 *   1. `COOKIE_DOMAIN` env wins (escape hatch for ad-hoc deployments).
 *   2. Dev / localhost / IP literals → host-only (no Domain attribute).
 *   3. Production `*.crosstoken.io` → `.crosstoken.io` cross-subdomain.
 *   4. Unknown production host → host-only fallback (safe default).
 *   5. `getCookieOptions` and `getClearCookieOptions` MUST agree on Domain
 *      so `clearCookie` matches the live cookie (RFC 6265bis).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JwtService, __testing } from '../../src/infrastructure/auth/JwtService';

const { deriveCookieDomain } = __testing;
const TEST_SECRET = 'test-secret-at-least-32-characters-long-xx';

describe('deriveCookieDomain', () => {
  const originalEnv = process.env.COOKIE_DOMAIN;

  beforeEach(() => {
    delete process.env.COOKIE_DOMAIN;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.COOKIE_DOMAIN;
    else process.env.COOKIE_DOMAIN = originalEnv;
  });

  it('returns COOKIE_DOMAIN env when set, regardless of hostname', () => {
    process.env.COOKIE_DOMAIN = '.example.com';
    expect(deriveCookieDomain('ant-server.crosstoken.io', true)).toBe('.example.com');
    expect(deriveCookieDomain('localhost', false)).toBe('.example.com');
    expect(deriveCookieDomain(undefined, true)).toBe('.example.com');
  });

  it('returns undefined for non-production (host-only)', () => {
    expect(deriveCookieDomain('ant-server.crosstoken.io', false)).toBeUndefined();
    expect(deriveCookieDomain('localhost', false)).toBeUndefined();
  });

  it('returns undefined for localhost / .localhost / IPv4 in production', () => {
    expect(deriveCookieDomain('localhost', true)).toBeUndefined();
    expect(deriveCookieDomain('foo.localhost', true)).toBeUndefined();
    expect(deriveCookieDomain('127.0.0.1', true)).toBeUndefined();
    expect(deriveCookieDomain('10.0.0.5', true)).toBeUndefined();
  });

  it('returns .crosstoken.io for any *.crosstoken.io host in production', () => {
    expect(deriveCookieDomain('crosstoken.io', true)).toBe('.crosstoken.io');
    expect(deriveCookieDomain('ant-server.crosstoken.io', true)).toBe('.crosstoken.io');
    expect(deriveCookieDomain('ant-preview.crosstoken.io', true)).toBe('.crosstoken.io');
    expect(deriveCookieDomain('ant.crosstoken.io', true)).toBe('.crosstoken.io');
  });

  it('returns undefined for unknown production hosts (host-only fallback)', () => {
    expect(deriveCookieDomain('foo.example.com', true)).toBeUndefined();
    expect(deriveCookieDomain('api.acme.io', true)).toBeUndefined();
  });

  it('returns undefined when hostname is missing in production', () => {
    expect(deriveCookieDomain(undefined, true)).toBeUndefined();
  });
});

describe('JwtService.getCookieOptions / getClearCookieOptions', () => {
  const originalEnv = process.env.COOKIE_DOMAIN;
  const svc = new JwtService({ secret: TEST_SECRET });

  beforeEach(() => {
    delete process.env.COOKIE_DOMAIN;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.COOKIE_DOMAIN;
    else process.env.COOKIE_DOMAIN = originalEnv;
  });

  it('omits domain on localhost (set/clear identical)', () => {
    const set = svc.getCookieOptions(true, 'localhost');
    const clear = svc.getClearCookieOptions(true, 'localhost');
    expect(set.domain).toBeUndefined();
    expect(clear.domain).toBeUndefined();
    expect(set.path).toBe(clear.path);
    expect(set.sameSite).toBe(clear.sameSite);
    expect(set.secure).toBe(clear.secure);
  });

  it('emits .crosstoken.io for *.crosstoken.io and stays consistent across set/clear', () => {
    const set = svc.getCookieOptions(true, 'ant-server.crosstoken.io');
    const clear = svc.getClearCookieOptions(true, 'ant-server.crosstoken.io');
    expect(set.domain).toBe('.crosstoken.io');
    expect(clear.domain).toBe('.crosstoken.io');
  });

  it('honors COOKIE_DOMAIN escape hatch in both options', () => {
    process.env.COOKIE_DOMAIN = '.override.test';
    const set = svc.getCookieOptions(true, 'ant-server.crosstoken.io');
    const clear = svc.getClearCookieOptions(true, 'ant-server.crosstoken.io');
    expect(set.domain).toBe('.override.test');
    expect(clear.domain).toBe('.override.test');
  });

  it('omits domain in development regardless of hostname', () => {
    const set = svc.getCookieOptions(false, 'ant-server.crosstoken.io');
    const clear = svc.getClearCookieOptions(false, 'ant-server.crosstoken.io');
    expect(set.domain).toBeUndefined();
    expect(clear.domain).toBeUndefined();
    expect(set.secure).toBe(false);
  });
});

/**
 * Behavior: `/auth/signout` emits TWO Set-Cookie headers — primary clear
 * (with the inferred Domain) AND a host-only legacy drain (without
 * Domain). RFC 6265bis requires attribute-set match for clearCookie, so a
 * Domain=.crosstoken.io clear cannot touch a host-only cookie left over
 * from a pre-`81637eaf` deploy. The dual-clear drains both shapes.
 */
describe('POST /api/auth/signout — dual-clear (legacy drain)', () => {
  const originalEnv = process.env.COOKIE_DOMAIN;

  beforeEach(() => {
    delete process.env.COOKIE_DOMAIN;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.COOKIE_DOMAIN;
    else process.env.COOKIE_DOMAIN = originalEnv;
  });

  async function postSignout(): Promise<{ setCookies: string[]; cacheControl: string | null }> {
    const http = await import('node:http');
    const express = (await import('express')).default;
    const cookieParser = (await import('cookie-parser')).default;
    const { createAuthRoutes } = await import(
      '../../src/periphery/adapters/http/routes/auth.routes'
    );
    const app = express();
    app.use(cookieParser());
    app.use(
      '/api',
      createAuthRoutes({
        authService: {} as any,
        workspaceResolver: {} as any,
        jwtService: new JwtService({ secret: TEST_SECRET }),
      }),
    );
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('bind failed');
      const res = await fetch(`http://127.0.0.1:${address.port}/api/auth/signout`, {
        method: 'POST',
      });
      // node-fetch coalesces same-name headers; getSetCookie() preserves all entries.
      const setCookies = (res.headers as any).getSetCookie?.() ?? [];
      const cacheControl = res.headers.get('cache-control');
      return { setCookies, cacheControl };
    } finally {
      await new Promise((resolve) => server.close(() => resolve(undefined)));
    }
  }

  it('emits exactly 2 Set-Cookie clears (one with Domain, one without) when COOKIE_DOMAIN is set', async () => {
    process.env.COOKIE_DOMAIN = '.crosstoken.io';
    const { setCookies } = await postSignout();
    const antSessionClears = setCookies.filter((c) => c.startsWith('ant_session=;'));
    expect(antSessionClears).toHaveLength(2);
    const withDomain = antSessionClears.filter((c) => /Domain=\.crosstoken\.io/i.test(c));
    const withoutDomain = antSessionClears.filter((c) => !/Domain=/i.test(c));
    expect(withDomain).toHaveLength(1);
    expect(withoutDomain).toHaveLength(1);
  });

  it('emits Cache-Control: private, no-store on /auth/signout', async () => {
    const { cacheControl } = await postSignout();
    expect(cacheControl).toMatch(/private/i);
    expect(cacheControl).toMatch(/no-store/i);
  });

  it('legacy-drain Set-Cookie carries Path=/ and HttpOnly (matches host-only live cookie attributes)', async () => {
    // COOKIE_DOMAIN forces the primary clearCookie to use a domain
    // attribute, so the legacy drain (always host-only by construction)
    // is the only Set-Cookie without `Domain=`.
    process.env.COOKIE_DOMAIN = '.crosstoken.io';
    const { setCookies } = await postSignout();
    const withoutDomain = setCookies
      .filter((c) => c.startsWith('ant_session=;'))
      .filter((c) => !/Domain=/i.test(c));
    expect(withoutDomain).toHaveLength(1);
    expect(withoutDomain[0]).toMatch(/Path=\//);
    expect(withoutDomain[0]).toMatch(/HttpOnly/i);
    expect(withoutDomain[0]).toMatch(/SameSite=Lax/i);
  });
});
