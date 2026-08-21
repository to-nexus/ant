/**
 * Same-origin guard — one axis, one row per case (H-NEW-001).
 *
 * The session is an httpOnly cookie, so the browser spends it on requests a
 * hostile page starts even though that page cannot read it. Once user content and
 * the control plane are separate origins, this guard is what makes the separation
 * mean something for state-changing calls: a document served on the content origin
 * is `Sec-Fetch-Site: same-site`, not `same-origin`, and is refused.
 *
 * The truth table is (method × Sec-Fetch-Site × credential kind).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'node:http';

import { createSameOriginGuard, __testing } from '../../src/periphery/adapters/http/middleware/sameOriginGuard';

const SESSION = 'ant_session=fake-token';

describe('createSameOriginGuard', () => {
  let server: http.Server;
  let baseUrl: string;
  let savedFrontend: string | undefined;

  beforeEach(async () => {
    savedFrontend = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = 'https://app.example.com';

    const app = express();
    // The real mount order: cookie-parser → auth → guard. A minimal cookie
    // reader stands in for cookie-parser so the guard sees `req.cookies`.
    app.use((req, _res, next) => {
      const raw = req.headers.cookie ?? '';
      (req as any).cookies = Object.fromEntries(
        raw.split(';').map(p => p.trim().split('=')).filter(p => p[0]).map(p => [p[0], p[1] ?? '']),
      );
      next();
    });
    app.use(createSameOriginGuard());
    app.all('/{*splat}', (_req, res) => { res.json({ ok: true }); });

    await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (savedFrontend === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = savedFrontend;
  });

  const call = (opts: {
    method?: string;
    path?: string;
    site?: string;
    origin?: string;
    cookie?: string;
    bearer?: boolean;
  }) => {
    const headers: Record<string, string> = {};
    if (opts.site) headers['Sec-Fetch-Site'] = opts.site;
    if (opts.origin) headers['Origin'] = opts.origin;
    if (opts.cookie !== undefined) headers['Cookie'] = opts.cookie;
    if (opts.bearer) headers['Authorization'] = 'Bearer desktop-token';
    return fetch(`${baseUrl}${opts.path ?? '/projects/p1/start'}`, {
      method: opts.method ?? 'POST',
      headers,
    });
  };

  it('allows a same-origin state change with the session cookie', async () => {
    expect((await call({ site: 'same-origin', cookie: SESSION })).status).toBe(200);
  });

  it('allows a user-initiated navigation (Sec-Fetch-Site: none)', async () => {
    expect((await call({ site: 'none', cookie: SESSION })).status).toBe(200);
  });

  it('refuses same-site — the content listener is a different ORIGIN, same site', async () => {
    const res = await call({ site: 'same-site', cookie: SESSION });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Cross-origin/);
  });

  it('refuses cross-site', async () => {
    expect((await call({ site: 'cross-site', cookie: SESSION })).status).toBe(403);
  });

  it('allows a cross-origin call from the registered frontend', async () => {
    const res = await call({ site: 'cross-site', origin: 'https://app.example.com', cookie: SESSION });
    expect(res.status).toBe(200);
  });

  it('still refuses an unregistered origin that claims same-site', async () => {
    expect((await call({ site: 'same-site', origin: 'https://deploy.example.com', cookie: SESSION })).status).toBe(403);
  });

  for (const method of ['GET', 'HEAD']) {
    it(`does not gate ${method} (no state change)`, async () => {
      expect((await call({ method, site: 'cross-site', cookie: SESSION })).status).toBe(200);
    });
  }

  it('does not gate a bearer-authenticated state change (no ambient credential)', async () => {
    expect((await call({ site: 'cross-site', bearer: true })).status).toBe(200);
  });

  it('does not gate a request with no session cookie (nothing to spend)', async () => {
    expect((await call({ site: 'cross-site' })).status).toBe(200);
  });

  it('exempts the health path', async () => {
    expect((await call({ path: '/health', site: 'cross-site', cookie: SESSION })).status).toBe(200);
  });

  describe('clients without Fetch Metadata', () => {
    it('allows when there is no Origin either (non-browser client)', async () => {
      expect((await call({ cookie: SESSION })).status).toBe(200);
    });

    it('allows a matching Origin', async () => {
      const port = new URL(baseUrl).port;
      expect((await call({ origin: `http://127.0.0.1:${port}`, cookie: SESSION })).status).toBe(200);
    });

    it('refuses a foreign Origin', async () => {
      expect((await call({ origin: 'https://deploy.example.com', cookie: SESSION })).status).toBe(403);
    });

    // Loopback origins are auto-allowed by `isAllowedFrontendOrigin` on purpose —
    // local mode is a single-developer trust boundary and the FE dev server runs on
    // its own port. So the port distinction is asserted on the predicate directly.
    it('allows any loopback Origin (local dev, by design)', async () => {
      const port = Number(new URL(baseUrl).port);
      expect((await call({ origin: `http://127.0.0.1:${port + 1}`, cookie: SESSION })).status).toBe(200);
    });
  });
});

describe('isSameOrigin — exact origin, port included', () => {
  const { isSameOrigin } = __testing;
  const req = (host: string, proto = 'https', forwarded?: Record<string, string>) =>
    ({ headers: { host, ...(forwarded ?? {}) }, protocol: proto, header: (n: string) =>
        (forwarded ?? {})[n.toLowerCase()] } as any);

  it('matches the same scheme, host and port', () => {
    expect(isSameOrigin(req('ant-preview.example.com'), 'https://ant-preview.example.com')).toBe(true);
  });

  it('rejects a different port — the content listener case', () => {
    expect(isSameOrigin(req('ant-preview.example.com:4102', 'https'), 'https://ant-preview.example.com:4103')).toBe(false);
  });

  it('rejects a different scheme', () => {
    expect(isSameOrigin(req('ant-preview.example.com'), 'http://ant-preview.example.com')).toBe(false);
  });

  it('honours X-Forwarded-Host / -Proto behind an ingress', () => {
    const forwarded = { 'x-forwarded-host': 'ant-preview.example.com', 'x-forwarded-proto': 'https' };
    expect(isSameOrigin(req('10.0.1.7:4102', 'http', forwarded), 'https://ant-preview.example.com')).toBe(true);
  });
});

describe('isTrustedCookieOrigin — IDE proxy + WS upgrade cookie CSRF (H-013)', () => {
  const { isTrustedCookieOrigin } = __testing;
  let savedFrontend: string | undefined;

  beforeEach(() => {
    savedFrontend = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = 'https://app.example.com';
  });
  afterEach(() => {
    if (savedFrontend === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = savedFrontend;
  });

  // Raw upgrade IncomingMessage shape: headers only, no express helpers.
  const raw = (headers: Record<string, string>) => ({ headers } as any);

  it('accepts same-origin (Sec-Fetch-Site)', () => {
    expect(isTrustedCookieOrigin(raw({ 'sec-fetch-site': 'same-origin' }))).toBe(true);
  });

  it('accepts a user-initiated navigation (none)', () => {
    expect(isTrustedCookieOrigin(raw({ 'sec-fetch-site': 'none' }))).toBe(true);
  });

  it('REFUSES same-site — attacker preview/deploy content shares the site', () => {
    expect(isTrustedCookieOrigin(raw({ 'sec-fetch-site': 'same-site' }))).toBe(false);
  });

  it('REFUSES cross-site', () => {
    expect(isTrustedCookieOrigin(raw({ 'sec-fetch-site': 'cross-site' }))).toBe(false);
  });

  it('accepts cross-site from the registered frontend origin', () => {
    expect(
      isTrustedCookieOrigin(raw({ 'sec-fetch-site': 'cross-site', origin: 'https://app.example.com' })),
    ).toBe(true);
  });

  it('refuses same-site even with an unregistered Origin', () => {
    expect(
      isTrustedCookieOrigin(raw({ 'sec-fetch-site': 'same-site', origin: 'https://deploy.example.com' })),
    ).toBe(false);
  });

  it('no Fetch Metadata + no Origin → allowed (non-browser client)', () => {
    expect(isTrustedCookieOrigin(raw({}))).toBe(true);
  });

  it('no Fetch Metadata + foreign Origin → refused', () => {
    expect(isTrustedCookieOrigin(raw({ origin: 'https://deploy.example.com' }))).toBe(false);
  });

  it('no Fetch Metadata + self Origin (X-Forwarded-*) → allowed', () => {
    expect(
      isTrustedCookieOrigin(
        raw({
          origin: 'https://api.example.com',
          host: '10.0.1.7:4100',
          'x-forwarded-host': 'api.example.com',
          'x-forwarded-proto': 'https',
        }),
      ),
    ).toBe(true);
  });
});
