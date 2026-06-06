import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import {
  buildCleanHeaders,
  extractForwardingContext,
  forwardRequestBody,
  isDevResourceRequest,
  rewriteLocation,
  rewriteSetCookiePath,
  streamUpstreamResponse,
  HOP_BY_HOP_HEADERS,
} from '../../src/periphery/adapters/http/middleware/proxyForwarding';

/**
 * proxyForwarding contract — the SSOT for what preview/deploy reverse proxies
 * send upstream and how they rewrite responses. Each test pins one behavior
 * that other parts of ANT depend on.
 */

function mockReq(opts: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  ip?: string;
  protocol?: string;
}): Request {
  return {
    method: opts.method ?? 'GET',
    url: opts.url ?? '/',
    headers: opts.headers ?? {},
    ip: opts.ip,
    protocol: opts.protocol,
  } as any as Request;
}

describe('buildCleanHeaders', () => {
  it('forwards all non-hop-by-hop headers', () => {
    const req = mockReq({
      headers: {
        'accept': 'text/html',
        'cookie': 'foo=1',
        'user-agent': 'vitest',
        'rsc': '1',
        'next-router-state-tree': '%5B%22%22%5D',
      },
    });
    const h = buildCleanHeaders(req, 'localhost', 30001);
    expect(h['accept']).toBe('text/html');
    expect(h['cookie']).toBe('foo=1');
    expect(h['user-agent']).toBe('vitest');
    expect(h['rsc']).toBe('1');
    expect(h['next-router-state-tree']).toBe('%5B%22%22%5D');
  });

  it('strips every hop-by-hop and conditional header', () => {
    const headers: Record<string, string> = { 'accept': '*/*' };
    for (const h of HOP_BY_HOP_HEADERS) headers[h] = 'should-strip';
    const req = mockReq({ headers });
    const out = buildCleanHeaders(req, 'localhost', 30001);
    for (const h of HOP_BY_HOP_HEADERS) {
      expect(out[h]).toBeUndefined();
    }
  });

  it('overrides Host and forces identity encoding', () => {
    const req = mockReq({
      headers: { host: 'ant-preview.crosstoken.io', 'accept-encoding': 'gzip, br' },
    });
    const h = buildCleanHeaders(req, '10.0.0.5', 30002);
    expect(h['host']).toBe('10.0.0.5:30002');
    expect(h['accept-encoding']).toBe('identity');
  });

  // Dev-resource cross-origin protection (Next 16 403s `_next/*` unless the
  // Origin is its trusted self-origin `localhost`). The proxy rewrites Origin
  // to localhost ONLY for `/_next` + `/__nextjs`, leaving app/Server-Action
  // requests on their real Origin. The pod-IP/public-host upstream is reached
  // via the connect target, never stamped into Origin.
  it('rewrites Origin to localhost for a /_next dev-resource request (with basePath prefix)', () => {
    const req = mockReq({
      url: '/to.nexus--probe--classboard--apps-app/_next/static/chunks/main.js',
      headers: { origin: 'https://ant-preview.crosstoken.io' },
    });
    const h = buildCleanHeaders(req, '10.0.28.196', 30000);
    expect(h['origin']).toBe('http://localhost:30000');
    expect(h['origin']).not.toContain('127.0.0.1');
    expect(h['origin']).not.toContain('ant-preview');
  });

  it('rewrites Origin to localhost for /__nextjs middleware requests', () => {
    const req = mockReq({
      url: '/k/__nextjs_original-stack-frame',
      headers: { origin: 'https://ant-preview.crosstoken.io' },
    });
    expect(buildCleanHeaders(req, '10.0.0.5', 30001)['origin']).toBe('http://localhost:30001');
  });

  it('leaves Origin untouched for app routes / Server Actions (not a dev resource)', () => {
    const req = mockReq({
      method: 'POST',
      url: '/k/dashboard',
      headers: { origin: 'https://ant-preview.crosstoken.io' },
    });
    expect(buildCleanHeaders(req, '10.0.0.5', 30001)['origin']).toBe('https://ant-preview.crosstoken.io');
  });

  it('does not synthesize an Origin for a dev-resource request that had none', () => {
    const req = mockReq({ url: '/k/_next/static/chunks/main.js', headers: {} });
    expect(buildCleanHeaders(req, '10.0.0.5', 30001)['origin']).toBeUndefined();
  });

  it('drops non-string header values without crashing', () => {
    // Express's req.headers can hold string[] (for repeated headers) and
    // undefined — those values would crash fetch's headers init.
    const req = {
      method: 'GET',
      headers: {
        'set-cookie': ['a=1', 'b=2'],
        'x-multi': undefined,
        'accept': 'text/html',
      },
    } as any as Request;
    const h = buildCleanHeaders(req, 'localhost', 1);
    expect(h['set-cookie']).toBeUndefined();
    expect(h['x-multi']).toBeUndefined();
    expect(h['accept']).toBe('text/html');
  });

  it('injects X-Forwarded-* when a context is supplied', () => {
    const req = mockReq({ headers: { host: 'ant-preview.crosstoken.io' } });
    const ctx = {
      externalHost: 'ant-preview.crosstoken.io',
      externalProto: 'https',
      externalClientIp: '203.0.113.7',
      externalPort: '443',
    };
    const h = buildCleanHeaders(req, 'localhost', 30001, ctx);
    expect(h['x-forwarded-host']).toBe('ant-preview.crosstoken.io');
    expect(h['x-forwarded-proto']).toBe('https');
    expect(h['x-forwarded-for']).toBe('203.0.113.7');
    expect(h['x-forwarded-port']).toBe('443');
  });

  it('preserves X-Forwarded-* already set upstream (e.g. by ingress)', () => {
    const req = mockReq({
      headers: {
        'x-forwarded-host': 'public.example.com',
        'x-forwarded-proto': 'https',
        'x-forwarded-for': '198.51.100.1, 203.0.113.7',
      },
    });
    const h = buildCleanHeaders(req, 'localhost', 30001, {
      externalHost: 'should-not-overwrite',
      externalProto: 'http',
      externalClientIp: 'should-not-overwrite',
    });
    expect(h['x-forwarded-host']).toBe('public.example.com');
    expect(h['x-forwarded-proto']).toBe('https');
    expect(h['x-forwarded-for']).toBe('198.51.100.1, 203.0.113.7');
  });
});

describe('extractForwardingContext', () => {
  it('reads Host / req.protocol / req.ip', () => {
    const req = mockReq({
      headers: { host: 'ant-preview.crosstoken.io' },
      protocol: 'https',
      ip: '203.0.113.7',
    });
    const ctx = extractForwardingContext(req);
    expect(ctx.externalHost).toBe('ant-preview.crosstoken.io');
    expect(ctx.externalProto).toBe('https');
    expect(ctx.externalClientIp).toBe('203.0.113.7');
  });

  it('honors pre-existing X-Forwarded-* over the immediate request', () => {
    const req = mockReq({
      headers: {
        'host': 'inner.example',
        'x-forwarded-host': 'public.example.com',
        'x-forwarded-proto': 'https',
        'x-forwarded-for': '198.51.100.1',
        'x-forwarded-port': '443',
      },
      protocol: 'http',
      ip: '10.0.0.5',
    });
    const ctx = extractForwardingContext(req);
    expect(ctx.externalHost).toBe('public.example.com');
    expect(ctx.externalProto).toBe('https');
    expect(ctx.externalClientIp).toBe('198.51.100.1');
    expect(ctx.externalPort).toBe('443');
  });
});

describe('forwardRequestBody', () => {
  it('returns empty for GET / HEAD / OPTIONS', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(forwardRequestBody(mockReq({ method }))).toEqual({});
    }
  });

  it('returns { body, duplex } for POST / PUT / PATCH / DELETE', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const req = mockReq({ method });
      const init = forwardRequestBody(req);
      expect(init.body).toBe(req);
      expect(init.duplex).toBe('half');
    }
  });
});

describe('rewriteSetCookiePath', () => {
  const base = '/deploy/o--u--p--f';

  it('appends Path when absent', () => {
    expect(rewriteSetCookiePath('foo=1', base)).toBe(`foo=1; Path=${base}`);
  });

  it('rewrites Path=/ to basePath', () => {
    expect(rewriteSetCookiePath('foo=1; Path=/', base)).toBe(`foo=1; Path=${base}`);
  });

  it('prefixes Path=/something with basePath', () => {
    expect(rewriteSetCookiePath('foo=1; Path=/x', base)).toBe(`foo=1; Path=${base}/x`);
    expect(rewriteSetCookiePath('foo=1; Path=/x/y; HttpOnly', base)).toBe(
      `foo=1; Path=${base}/x/y; HttpOnly`,
    );
  });

  it('is idempotent — no-op when already under basePath', () => {
    const c = `foo=1; Path=${base}/x; HttpOnly`;
    expect(rewriteSetCookiePath(c, base)).toBe(c);
  });

  it('handles attribute names case-insensitively', () => {
    // RFC 6265: cookie attribute names are case-insensitive.
    expect(rewriteSetCookiePath('foo=1; path=/x', base)).toBe(`foo=1; Path=${base}/x`);
  });

  it('leaves malformed Path values alone', () => {
    // Cookies with a Path that does not start with `/` are non-conforming —
    // safer to pass through than to manufacture an invalid value.
    const c = 'foo=1; Path=relative';
    expect(rewriteSetCookiePath(c, base)).toBe(c);
  });
});

describe('rewriteLocation', () => {
  const base = '/deploy/o--u--p--f';
  const upstream = '127.0.0.1:30001';

  it('prefixes a relative path', () => {
    expect(rewriteLocation('/abc', base, upstream)).toBe(`${base}/abc`);
    expect(rewriteLocation('/abc?x=1', base, upstream)).toBe(`${base}/abc?x=1`);
  });

  it('is idempotent for already-prefixed relative paths', () => {
    expect(rewriteLocation(`${base}/abc`, base, upstream)).toBe(`${base}/abc`);
    expect(rewriteLocation(`${base}`, base, upstream)).toBe(`${base}`);
  });

  it('rewrites absolute URLs pointing at the upstream host to host-relative form', () => {
    expect(rewriteLocation('http://127.0.0.1:30001/abc', base, upstream)).toBe(`${base}/abc`);
    // localhost / 127.0.0.1 / explicit upstreamHost all collapse to the same form
    expect(rewriteLocation('http://localhost:30001/abc?y=2', base, upstream)).toBe(`${base}/abc?y=2`);
  });

  it('leaves external absolute URLs unchanged (OAuth provider redirects)', () => {
    const oauthUrl = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x';
    expect(rewriteLocation(oauthUrl, base, upstream)).toBe(oauthUrl);
    expect(rewriteLocation('https://other.example.com/x', base, upstream)).toBe(
      'https://other.example.com/x',
    );
  });

  it('leaves non-path values alone', () => {
    // Protocol-relative URLs and fragments don't fit any clean rewriting rule.
    expect(rewriteLocation('//cdn.example.com/x', base, upstream)).toBe('//cdn.example.com/x');
  });
});

describe('streamUpstreamResponse', () => {
  // Tests use body-less Response objects so we don't need to implement the
  // full Writable contract on the mock; streamUpstreamResponse calls
  // `res.end()` directly when `response.body` is null.
  function mockRes() {
    const ctx = {
      headers: {} as Record<string, string | string[]>,
      statusCode: 200,
      ended: false,
    };
    const api: any = {
      status(code: number) {
        ctx.statusCode = code;
        return api;
      },
      setHeader(k: string, v: string | string[]) {
        ctx.headers[k.toLowerCase()] = v;
        return api;
      },
      removeHeader(k: string) {
        delete ctx.headers[k.toLowerCase()];
      },
      end() {
        ctx.ended = true;
      },
      get headers() {
        return ctx.headers;
      },
      get statusCode() {
        return ctx.statusCode;
      },
      get ended() {
        return ctx.ended;
      },
    };
    return api;
  }

  it('strips etag / last-modified family from response', async () => {
    const upstream = new Response(null, {
      status: 200,
      headers: {
        'etag': '"abc"',
        'last-modified': 'Thu, 01 Jan 1970 00:00:00 GMT',
        'content-type': 'text/plain',
      },
    });
    const res = mockRes();
    await streamUpstreamResponse(upstream, res, {});
    expect(res.headers['etag']).toBeUndefined();
    expect(res.headers['last-modified']).toBeUndefined();
    expect(res.headers['content-type']).toBe('text/plain');
  });

  it('rewrites Set-Cookie Path when basePath is supplied', async () => {
    const upstream = new Response(null, {
      status: 200,
      headers: { 'set-cookie': 'ant_session=abc; Path=/; HttpOnly' },
    });
    const res = mockRes();
    await streamUpstreamResponse(upstream, res, { basePath: '/deploy/o--u--p--f', upstreamHost: 'localhost:1' });
    const cookies = res.headers['set-cookie'] as string[];
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain('Path=/deploy/o--u--p--f');
    expect(cookies[0]).toContain('HttpOnly');
  });

  it('leaves Set-Cookie alone when no basePath supplied (backend route)', async () => {
    const upstream = new Response(null, {
      status: 200,
      headers: { 'set-cookie': 'foo=1; Path=/api' },
    });
    const res = mockRes();
    await streamUpstreamResponse(upstream, res, {});
    const cookies = res.headers['set-cookie'] as string[];
    expect(cookies[0]).toBe('foo=1; Path=/api');
  });

  it('rewrites Location header relative paths under basePath', async () => {
    const upstream = new Response(null, {
      status: 302,
      headers: { 'location': '/abc' },
    });
    const res = mockRes();
    await streamUpstreamResponse(upstream, res, {
      basePath: '/deploy/o--u--p--f',
      upstreamHost: 'localhost:30001',
    });
    expect(res.headers['location']).toBe('/deploy/o--u--p--f/abc');
  });

  it('appends extra Set-Cookies alongside upstream cookies', async () => {
    const upstream = new Response(null, {
      status: 200,
      headers: { 'set-cookie': 'a=1; Path=/' },
    });
    const res = mockRes();
    await streamUpstreamResponse(upstream, res, {
      basePath: '/deploy/x',
      upstreamHost: 'localhost:1',
      extraSetCookies: ['preview_sk=xyz; Path=/x; SameSite=Lax'],
    });
    const cookies = res.headers['set-cookie'] as string[];
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain('Path=/deploy/x');
    expect(cookies[1]).toBe('preview_sk=xyz; Path=/x; SameSite=Lax');
  });

  it('forces cache-control when supplied', async () => {
    const upstream = new Response(null, {
      status: 200,
      headers: { 'cache-control': 'public, max-age=3600' },
    });
    const res = mockRes();
    await streamUpstreamResponse(upstream, res, { cacheControl: 'no-cache, no-store, must-revalidate' });
    expect(res.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
  });
});

describe('isDevResourceRequest', () => {
  it('matches /_next and /__nextjs anywhere in the path (basePath-prefixed)', () => {
    expect(isDevResourceRequest('/k/_next/static/x.js')).toBe(true);
    expect(isDevResourceRequest('/_next/webpack-hmr')).toBe(true);
    expect(isDevResourceRequest('/k/__nextjs_original-stack-frame')).toBe(true);
  });
  it('does not match app routes / API / undefined', () => {
    expect(isDevResourceRequest('/k/dashboard')).toBe(false);
    expect(isDevResourceRequest('/api/me')).toBe(false);
    expect(isDevResourceRequest(undefined)).toBe(false);
  });
});
