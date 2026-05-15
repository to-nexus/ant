import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { Request, Response, NextFunction } from 'express';
import { createDeployProxyMiddleware } from '../../src/periphery/adapters/http/middleware/deployProxy';

/**
 * Regression anchors for the deploy reverse proxy's request/response contract.
 *
 * The anchor test is `Next.js RSC navigation header is forwarded`: before
 * the proxyForwarding refactor, deploy stripped every request header except
 * `host` and `accept`, causing Next.js App Router soft navigation to
 * degrade to hard reloads (see
 * .claude/plans/ant-xor-ant-preview-server-dreamy-sky.md). If this test
 * starts failing, the bug is back.
 */

const URL_KEY = 'org--user--proj--feat';

function mockReq(opts: {
  method?: string;
  url?: string;
  path?: string;
  headers?: Record<string, string>;
}): Request {
  const url = opts.url ?? `/${URL_KEY}/`;
  return {
    method: opts.method ?? 'GET',
    url,
    path: opts.path ?? url.split('?')[0],
    headers: opts.headers ?? { host: 'ant-preview.crosstoken.io' },
    protocol: 'https',
    ip: '203.0.113.7',
  } as any as Request;
}

function mockRes() {
  const ctx = {
    headers: {} as Record<string, string | string[]>,
    statusCode: 0,
    body: undefined as any,
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
    json(obj: any) {
      ctx.body = obj;
      return api;
    },
    end() {
      ctx.ended = true;
    },
    _ctx: ctx,
  };
  return api;
}

function mockNext(): NextFunction & { called: boolean } {
  const fn = (() => {
    fn.called = true;
  }) as any;
  fn.called = false;
  return fn;
}

function mockDeps(state: {
  packages: Array<{ name: string; slug?: string; port: number }>;
  host?: string;
}) {
  return {
    ensureRunning: vi.fn(async () => ({
      tenantId: 'org',
      userId: 'user',
      projectId: 'proj',
      feature: 'feat',
      host: state.host || '127.0.0.1',
      packages: state.packages,
    } as any)),
    touchDeploy: vi.fn(async () => {}),
    updateDeploy: vi.fn(async () => {}),
    broadcastStatus: vi.fn(async () => {}),
  };
}

let fetchSpy: any;
let lastFetchUrl: string | undefined;
let lastFetchInit: RequestInit | undefined;

beforeEach(() => {
  lastFetchUrl = undefined;
  lastFetchInit = undefined;
  fetchSpy = vi.spyOn(globalThis as any, 'fetch').mockImplementation((async (
    url: string,
    init?: RequestInit,
  ) => {
    lastFetchUrl = String(url);
    lastFetchInit = init;
    return new Response(null, { status: 204 });
  }) as any);
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe('deploy proxy — request forwarding', () => {
  it('REGRESSION ANCHOR: forwards Next.js RSC headers to upstream', async () => {
    // The bug: deploy proxy stripped RSC headers, causing Next.js client
    // soft navigation (router.replace) to fall back to a hard reload.
    // Symptom in ant-xor: clicking social-login appeared to "just refresh"
    // because the /signup RSC fetch returned HTML, triggering MPA fallback
    // that lost Zustand state and bounced back through the AuthGuard.
    const deps = mockDeps({
      packages: [{ name: 'web', slug: 'web', port: 30001 }],
    });
    const middleware = createDeployProxyMiddleware(deps);

    const req = mockReq({
      url: `/${URL_KEY}/signup`,
      headers: {
        host: 'ant-preview.crosstoken.io',
        'rsc': '1',
        'next-router-state-tree': '%5B%22%22%2C%7B%7D%5D',
        'next-url': '/signup',
        'cookie': 'ant_session=abc; other=1',
      },
    });
    await middleware(req, mockRes(), mockNext());

    expect(lastFetchUrl).toBe(`http://127.0.0.1:30001/deploy/${URL_KEY}/signup`);
    const sentHeaders = lastFetchInit?.headers as Record<string, string>;
    expect(sentHeaders['rsc']).toBe('1');
    expect(sentHeaders['next-router-state-tree']).toBe('%5B%22%22%2C%7B%7D%5D');
    expect(sentHeaders['next-url']).toBe('/signup');
    expect(sentHeaders['cookie']).toBe('ant_session=abc; other=1');
  });

  it('injects X-Forwarded-Host/Proto/For from the incoming request', async () => {
    const deps = mockDeps({
      packages: [{ name: 'web', slug: 'web', port: 30001 }],
    });
    const middleware = createDeployProxyMiddleware(deps);

    const req = mockReq({ url: `/${URL_KEY}/` });
    await middleware(req, mockRes(), mockNext());

    const sentHeaders = lastFetchInit?.headers as Record<string, string>;
    expect(sentHeaders['x-forwarded-host']).toBe('ant-preview.crosstoken.io');
    expect(sentHeaders['x-forwarded-proto']).toBe('https');
    expect(sentHeaders['x-forwarded-for']).toBe('203.0.113.7');
  });

  it('overrides Host to the upstream bind address', async () => {
    const deps = mockDeps({
      packages: [{ name: 'web', slug: 'web', port: 30001 }],
      host: '10.0.0.5',
    });
    const middleware = createDeployProxyMiddleware(deps);
    await middleware(mockReq({ url: `/${URL_KEY}/` }), mockRes(), mockNext());

    const sentHeaders = lastFetchInit?.headers as Record<string, string>;
    expect(sentHeaders['host']).toBe('10.0.0.5:30001');
  });

  it('streams POST body to upstream with duplex: half', async () => {
    const deps = mockDeps({
      packages: [{ name: 'web', slug: 'web', port: 30001 }],
    });
    const middleware = createDeployProxyMiddleware(deps);

    const req = mockReq({
      method: 'POST',
      url: `/${URL_KEY}/api/login`,
      headers: { host: 'ant-preview.crosstoken.io', 'content-type': 'application/json' },
    });
    await middleware(req, mockRes(), mockNext());

    expect((lastFetchInit as any)?.body).toBe(req);
    expect((lastFetchInit as any)?.duplex).toBe('half');
  });

  it('preserves /deploy/<urlKey> prefix on the upstream URL', async () => {
    // The upstream `next start` was built with NEXT_PUBLIC_BASE_PATH=/deploy/<urlKey>
    // and serves only paths under that prefix. The proxy must re-add the
    // prefix that `app.use('/deploy/', ...)` already stripped from req.url.
    const deps = mockDeps({
      packages: [{ name: 'web', slug: 'web', port: 30001 }],
    });
    const middleware = createDeployProxyMiddleware(deps);

    await middleware(
      mockReq({ url: `/${URL_KEY}/_next/static/chunks/main.js` }),
      mockRes(),
      mockNext(),
    );

    expect(lastFetchUrl).toBe(
      `http://127.0.0.1:30001/deploy/${URL_KEY}/_next/static/chunks/main.js`,
    );
  });

  it('returns 404 when the deploy is hibernated and cannot be rehydrated', async () => {
    const deps = {
      ensureRunning: vi.fn(async () => null),
      touchDeploy: vi.fn(),
      updateDeploy: vi.fn(),
      broadcastStatus: vi.fn(),
    };
    const middleware = createDeployProxyMiddleware(deps as any);
    const res = mockRes();
    await middleware(mockReq({ url: `/${URL_KEY}/` }), res, mockNext());

    expect(res._ctx.statusCode).toBe(404);
    expect(res._ctx.body).toEqual({ error: 'Deploy unavailable' });
    expect(lastFetchUrl).toBeUndefined();
  });

  it('passes through to next() when the first segment is not a urlKey', async () => {
    const deps = mockDeps({
      packages: [{ name: 'web', slug: 'web', port: 30001 }],
    });
    const middleware = createDeployProxyMiddleware(deps);
    const next = mockNext();
    await middleware(mockReq({ url: '/health' }), mockRes(), next);
    expect(next.called).toBe(true);
    expect(deps.ensureRunning).not.toHaveBeenCalled();
  });
});

describe('deploy proxy — transport retry', () => {
  // Fake timers drain `fetchWithTransportRetry`'s exponential-backoff sleeps
  // (250 + 500 + 1000 + 2000 + 2500 ms) without waiting in real time.
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries a transient transport failure then forwards the upstream response', async () => {
    let attempts = 0;
    fetchSpy.mockImplementation((async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError('fetch failed');
      return new Response(null, { status: 204 });
    }) as any);
    const deps = mockDeps({ packages: [{ name: 'web', slug: 'web', port: 30001 }] });
    const middleware = createDeployProxyMiddleware(deps);
    const res = mockRes();

    const pending = middleware(mockReq({ url: `/${URL_KEY}/` }), res, mockNext());
    await vi.runAllTimersAsync();
    await pending;

    expect(attempts).toBe(2);
    expect(res._ctx.statusCode).toBe(204);
    // Single rehydrate at entry — no second ensureRunning (rehydrate path
    // not triggered), no hibernated marker.
    expect(deps.ensureRunning).toHaveBeenCalledTimes(1);
    expect(deps.updateDeploy).not.toHaveBeenCalled();
  });

  it('falls through to rehydrate only after transport retries exhaust', async () => {
    fetchSpy.mockImplementation((async () => {
      throw new TypeError('ECONNREFUSED 127.0.0.1:30001');
    }) as any);
    const deps = mockDeps({ packages: [{ name: 'web', slug: 'web', port: 30001 }] });
    const middleware = createDeployProxyMiddleware(deps);
    const res = mockRes();

    const pending = middleware(mockReq({ url: `/${URL_KEY}/` }), res, mockNext());
    await vi.runAllTimersAsync();
    await pending;

    // outer catch hit: hibernated marker, ensureRunning called twice (entry +
    // rehydrate), eventually unavailable + 502.
    expect(deps.updateDeploy).toHaveBeenCalledWith(
      'org',
      'user',
      'proj',
      'feat',
      expect.objectContaining({ phase: 'hibernated' }),
    );
    expect(deps.ensureRunning).toHaveBeenCalledTimes(2);
    expect(res._ctx.statusCode).toBe(502);
  });

  it('REGRESSION ANCHOR: passes upstream 5xx through verbatim without retry', async () => {
    // Retrying 5xx would mask genuine upstream failures that the readiness
    // probe and clients need to see. Anchor: transient transport retry must
    // never widen to cover HTTP errors.
    let calls = 0;
    fetchSpy.mockImplementation((async () => {
      calls += 1;
      return new Response(null, { status: 500 });
    }) as any);
    const deps = mockDeps({ packages: [{ name: 'web', slug: 'web', port: 30001 }] });
    const middleware = createDeployProxyMiddleware(deps);
    const res = mockRes();

    const pending = middleware(mockReq({ url: `/${URL_KEY}/` }), res, mockNext());
    await vi.runAllTimersAsync();
    await pending;

    expect(calls).toBe(1);
    expect(res._ctx.statusCode).toBe(500);
    expect(deps.updateDeploy).not.toHaveBeenCalled();
  });

  it('does not retry non-transport errors (e.g. aborted)', async () => {
    let calls = 0;
    fetchSpy.mockImplementation((async () => {
      calls += 1;
      throw new Error('aborted');
    }) as any);
    const deps = mockDeps({ packages: [{ name: 'web', slug: 'web', port: 30001 }] });
    const middleware = createDeployProxyMiddleware(deps);
    const res = mockRes();

    const pending = middleware(mockReq({ url: `/${URL_KEY}/` }), res, mockNext());
    await vi.runAllTimersAsync();
    await pending;

    // 1 fetch for the initial tryProxy + 1 fetch for the rehydrate retry —
    // neither triggers withRetry's backoff because 'aborted' fails the
    // transport-error predicate.
    expect(calls).toBe(2);
    expect(deps.updateDeploy).toHaveBeenCalledWith(
      'org',
      'user',
      'proj',
      'feat',
      expect.objectContaining({ phase: 'hibernated' }),
    );
    expect(res._ctx.statusCode).toBe(502);
  });
});

describe('deploy proxy — response rewriting', () => {
  it('rewrites Set-Cookie Path to be scoped under /deploy/<urlKey>', async () => {
    // Without this, an upstream cookie with Path=/ would apply to every
    // deploy on the same ant-preview.crosstoken.io host, causing cross-deploy
    // cookie pollution.
    fetchSpy.mockImplementationOnce(async () => {
      return new Response(null, {
        status: 200,
        headers: { 'set-cookie': 'ant_session=tok; Path=/; HttpOnly' },
      });
    });
    const deps = mockDeps({
      packages: [{ name: 'web', slug: 'web', port: 30001 }],
    });
    const middleware = createDeployProxyMiddleware(deps);

    const res = mockRes();
    await middleware(mockReq({ url: `/${URL_KEY}/api/auth/login` }), res, mockNext());

    const cookies = res._ctx.headers['set-cookie'] as string[];
    expect(cookies).toBeDefined();
    expect(cookies[0]).toContain(`Path=/deploy/${URL_KEY}`);
    expect(cookies[0]).toContain('HttpOnly');
  });

  it('rewrites relative Location header to include the deploy prefix', async () => {
    fetchSpy.mockImplementationOnce(async () => {
      return new Response(null, { status: 302, headers: { location: '/home' } });
    });
    const deps = mockDeps({
      packages: [{ name: 'web', slug: 'web', port: 30001 }],
    });
    const middleware = createDeployProxyMiddleware(deps);

    const res = mockRes();
    await middleware(mockReq({ url: `/${URL_KEY}/login` }), res, mockNext());

    expect(res._ctx.headers['location']).toBe(`/deploy/${URL_KEY}/home`);
  });
});

describe('deploy proxy — client abort propagation (SSE)', () => {
  // Real req object backed by EventEmitter so `req.once('close', ...)` fires.
  // Plain-object mocks used elsewhere bypass the abort wiring via feature-detect.
  function eventfulReq(): Request & EventEmitter {
    const ee: any = new EventEmitter();
    ee.method = 'GET';
    ee.url = `/${URL_KEY}/api/sse`;
    ee.path = ee.url;
    ee.headers = { host: 'ant-preview.crosstoken.io' };
    ee.protocol = 'https';
    ee.ip = '203.0.113.7';
    return ee;
  }

  it('passes an AbortSignal in the upstream fetch init', async () => {
    const deps = mockDeps({ packages: [{ name: 'web', slug: 'web', port: 30001 }] });
    const middleware = createDeployProxyMiddleware(deps);

    await middleware(eventfulReq(), mockRes(), mockNext());

    expect(lastFetchInit?.signal).toBeInstanceOf(AbortSignal);
    expect((lastFetchInit!.signal as AbortSignal).aborted).toBe(false);
  });

  it('aborts the signal when the client request emits close', async () => {
    const deps = mockDeps({ packages: [{ name: 'web', slug: 'web', port: 30001 }] });
    const middleware = createDeployProxyMiddleware(deps);

    const req = eventfulReq();
    await middleware(req, mockRes(), mockNext());
    const signal = lastFetchInit!.signal as AbortSignal;

    expect(signal.aborted).toBe(false);
    req.emit('close');
    expect(signal.aborted).toBe(true);
  });
});
