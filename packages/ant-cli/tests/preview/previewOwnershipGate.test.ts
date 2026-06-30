/**
 * Preview proxy owner-only access gate.
 *
 * The owner of a preview is the `(tenantId, userId)` baked into the urlKey's
 * first two segments. In cloud mode a request must carry a session cookie
 * whose `org`/`sub` match — otherwise 403. Local mode (no jwtService) is
 * always owner-accessible (single tenant). A valid session for a DIFFERENT
 * owner must be rejected even though the JWT itself is valid.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { createPreviewProxyMiddleware } from '../../src/periphery/adapters/http/middleware/previewProxy';
import type { ProxyJwtVerifier } from '../../src/periphery/adapters/http/middleware/proxyOwnership';

const URL_KEY = 'org--user--proj--feat'; // owner = (org, user)
const COOKIE = 'ant_session';

// Stub verifier: token `org|sub`; 'bad' throws.
const jwt: ProxyJwtVerifier = {
  verify(token: string) {
    if (token === 'bad') throw new Error('invalid');
    const [org, sub] = token.split('|');
    return { org, sub };
  },
};

function mockRegistry(): any {
  return {
    getPreview: vi.fn(async () => ({
      tenantId: 'org', userId: 'user', projectId: 'proj', feature: 'feat',
      running: true, ready: true, host: '127.0.0.1', port: 3000,
      packages: [{ name: 'web', slug: 'web', type: 'frontend', port: 3000, urlKey: URL_KEY }],
    })),
    touchPreview: vi.fn(async () => {}),
  };
}

function mockReq(token?: string): Request {
  const url = `/${URL_KEY}/dashboard`;
  return {
    url,
    method: 'GET',
    path: url,
    headers: { host: 'preview.test', ...(token ? { cookie: `${COOKIE}=${token}` } : {}) },
  } as any as Request;
}

function mockRes(): Response & { _captured: any } {
  const res: any = {
    _captured: { status: undefined, body: undefined, headers: {} as Record<string, string> },
    status(code: number) { this._captured.status = code; return this; },
    setHeader(k: string, v: string) { this._captured.headers[k.toLowerCase()] = v; return this; },
    removeHeader(k: string) { delete this._captured.headers[k.toLowerCase()]; },
    end() {},
    json(obj: any) { this._captured.body = obj; return this; },
  };
  return res;
}

function mockNext(): NextFunction & { called: boolean } {
  const fn = (() => { fn.called = true; }) as any;
  fn.called = false;
  return fn;
}

let fetchSpy: any;
let lastFetchUrl: string | undefined;

beforeEach(() => {
  lastFetchUrl = undefined;
  fetchSpy = vi.spyOn(globalThis as any, 'fetch').mockImplementation((async (url: string) => {
    lastFetchUrl = String(url);
    return new Response(null, { status: 204 });
  }) as any);
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe('previewProxy owner-only gate', () => {
  it('local mode (no jwtService) → proxies regardless of cookie', async () => {
    const mw = createPreviewProxyMiddleware({ portRegistry: mockRegistry() });
    const res = mockRes();
    await mw(mockReq(), res, mockNext());
    expect(res._captured.status).not.toBe(403);
    expect(lastFetchUrl).toBe(`http://127.0.0.1:3000/${URL_KEY}/dashboard`);
  });

  it('cloud mode + owner cookie → proxies', async () => {
    const mw = createPreviewProxyMiddleware({ portRegistry: mockRegistry(), jwtService: jwt, cookieName: COOKIE });
    const res = mockRes();
    await mw(mockReq('org|user'), res, mockNext());
    expect(res._captured.status).not.toBe(403);
    expect(lastFetchUrl).toBe(`http://127.0.0.1:3000/${URL_KEY}/dashboard`);
  });

  it('cloud mode + no cookie → 403, no upstream fetch', async () => {
    const mw = createPreviewProxyMiddleware({ portRegistry: mockRegistry(), jwtService: jwt, cookieName: COOKIE });
    const res = mockRes();
    await mw(mockReq(), res, mockNext());
    expect(res._captured.status).toBe(403);
    expect(lastFetchUrl).toBeUndefined();
  });

  it('cloud mode + other tenant → 403', async () => {
    const mw = createPreviewProxyMiddleware({ portRegistry: mockRegistry(), jwtService: jwt, cookieName: COOKIE });
    const res = mockRes();
    await mw(mockReq('team-x|user'), res, mockNext());
    expect(res._captured.status).toBe(403);
    expect(lastFetchUrl).toBeUndefined();
  });

  it('cloud mode + other user → 403', async () => {
    const mw = createPreviewProxyMiddleware({ portRegistry: mockRegistry(), jwtService: jwt, cookieName: COOKIE });
    const res = mockRes();
    await mw(mockReq('org|intruder'), res, mockNext());
    expect(res._captured.status).toBe(403);
    expect(lastFetchUrl).toBeUndefined();
  });
});
