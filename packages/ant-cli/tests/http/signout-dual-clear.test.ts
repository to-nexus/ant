/**
 * `/auth/signout` dual-clear (legacy drain). Route-level behavior of the OSS
 * `createAuthRoutes` signout handler; the JwtService cookie-domain derivation
 * unit tests live in tests/http/cookie-domain-derivation.test.ts.
 *
 * Behavior: `/auth/signout` emits TWO Set-Cookie headers — primary clear (with the
 * inferred Domain) AND a host-only legacy drain (without Domain). RFC 6265bis requires
 * attribute-set match for clearCookie, so a Domain=.cross.nexus clear cannot touch a
 * host-only cookie left over from an earlier deploy. The dual-clear drains both shapes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JwtService } from '../../src/infrastructure/auth/JwtService';
import { createAuthRoutes } from '../../src/periphery/adapters/http/routes/auth.routes';

const TEST_SECRET = 'test-secret-at-least-32-characters-long-xx';

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
    process.env.COOKIE_DOMAIN = '.cross.nexus';
    const { setCookies } = await postSignout();
    const antSessionClears = setCookies.filter((c) => c.startsWith('ant_session=;'));
    expect(antSessionClears).toHaveLength(2);
    const withDomain = antSessionClears.filter((c) => /Domain=\.cross\.nexus/i.test(c));
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
    // COOKIE_DOMAIN forces the primary clearCookie to use a domain attribute, so the
    // legacy drain (always host-only by construction) is the only Set-Cookie without `Domain=`.
    process.env.COOKIE_DOMAIN = '.cross.nexus';
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
