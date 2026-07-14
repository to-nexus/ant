/**
 * Peer-forward host recovery (X-Forwarded-Host SSOT).
 *
 * Root cause it locks: the cross-pod owner-forward sends the request with
 * undici `fetch`, and `Host` is a fetch-spec FORBIDDEN header — undici
 * silently replaces it with the target `ip:port`. The owner pod therefore
 * received `Host: 10.x.x.x:4102`, its subdomain label resolution (which read
 * only `req.headers.host`) missed, both proxies deferred, and the request fell
 * through to the Express catch-all → `{"error":"Not Found","message":"Preview
 * endpoint not found"}` while the preview was healthy. With ALB session
 * stickiness the browser stayed pinned to the non-owner pod, so the 404 was
 * consistent, not intermittent.
 *
 * The fix is two-sided, locked here:
 *   - forward side: `buildForwardHeaders` drops `host` (undici overwrites it
 *     anyway) and guarantees `x-forwarded-host` carries the original host.
 *   - owner side: subdomain label resolution reads the externally-visible
 *     host (`extractForwardingContext` — XFH first, then Host) in BOTH the
 *     preview and deploy proxies, mirroring the WS upgrade handler.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  buildForwardHeaders,
  extractForwardingContext,
} from '../../src/periphery/adapters/http/middleware/proxyForwarding';
import { createPreviewProxyMiddleware } from '../../src/periphery/adapters/http/middleware/previewProxy';
import { createDeployProxyMiddleware } from '../../src/periphery/adapters/http/middleware/deployProxy';
import { PREVIEW_PEER_FORWARD_HEADER } from '../../src/periphery/adapters/http/middleware/previewRouting';

const BASE = 'ant-preview.test';
const DEPLOY_BASE = 'ant-deploy.test';
const SERVER = { tenantId: 'org', userId: 'user', projectId: 'proj', feature: 'feat' };
const LABEL = 'org--user--proj--feat';

function mockReq(url: string, headers: Record<string, string>): Request {
  return { url, method: 'GET', path: url.split('?')[0], headers } as any;
}
function mockRes(): Response & { _c: any } {
  const res: any = {
    _c: { status: undefined, body: undefined },
    status(c: number) { this._c.status = c; return this; },
    setHeader() { return this; },
    removeHeader() {},
    end() {},
    json(o: any) { this._c.body = o; return this; },
  };
  return res;
}
function mockNext(): NextFunction & { called: boolean } {
  const fn: any = () => { fn.called = true; };
  fn.called = false;
  return fn;
}

describe('extractForwardingContext — externally-visible host', () => {
  it('prefers X-Forwarded-Host over Host', () => {
    const ctx = extractForwardingContext({ headers: { host: '10.0.28.209:4102', 'x-forwarded-host': `${LABEL}.${BASE}` } });
    expect(ctx.externalHost).toBe(`${LABEL}.${BASE}`);
  });

  it('takes the first entry of a comma-joined X-Forwarded-Host list', () => {
    const ctx = extractForwardingContext({ headers: { host: 'ignored', 'x-forwarded-host': `${LABEL}.${BASE}, inner.proxy` } });
    expect(ctx.externalHost).toBe(`${LABEL}.${BASE}`);
  });

  it('falls back to Host when X-Forwarded-Host is absent', () => {
    const ctx = extractForwardingContext({ headers: { host: `${LABEL}.${BASE}` } });
    expect(ctx.externalHost).toBe(`${LABEL}.${BASE}`);
  });
});

describe('buildForwardHeaders — peer-forward header contract', () => {
  it('drops host (undici forbidden header) and carries it on x-forwarded-host instead', () => {
    const headers = buildForwardHeaders(mockReq('/', { host: `${LABEL}.${BASE}`, cookie: 'ant_session=t' }));
    expect(headers['host']).toBeUndefined();
    expect(headers['x-forwarded-host']).toBe(`${LABEL}.${BASE}`);
    expect(headers['cookie']).toBe('ant_session=t'); // owner re-verifies ownership
  });

  it('preserves an ingress-set x-forwarded-host over the immediate Host', () => {
    const headers = buildForwardHeaders(mockReq('/', { host: 'pod-internal:4102', 'x-forwarded-host': `${LABEL}.${BASE}` }));
    expect(headers['x-forwarded-host']).toBe(`${LABEL}.${BASE}`);
  });
});

describe('previewProxy subdomain — owner side recovers the label from X-Forwarded-Host', () => {
  let fetchSpy: any;
  let lastUrl: string | undefined;

  beforeEach(() => {
    process.env.ANT_PREVIEW_BASE_DOMAIN = BASE;
    lastUrl = undefined;
    fetchSpy = vi.spyOn(globalThis as any, 'fetch').mockImplementation((async (u: string) => {
      lastUrl = String(u);
      return new Response(null, { status: 204 });
    }) as any);
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    delete process.env.ANT_PREVIEW_BASE_DOMAIN;
    delete process.env.ANT_DEPLOY_BASE_DOMAIN;
  });

  const registry = () => ({
    listPreviews: vi.fn(async () => [{ ...SERVER, host: '127.0.0.1', port: 3000, packages: [{ name: 'web', slug: 'web', type: 'frontend', port: 3000, urlKey: LABEL }] }]),
    touchPreview: vi.fn(async () => {}),
  }) as any;

  it('serves a peer-forwarded request (Host = pod ip:port, label only on XFH) — the exact incident shape', async () => {
    const mw = createPreviewProxyMiddleware({ portRegistry: registry() });
    const next = mockNext();
    const req = mockReq('/', {
      host: '10.0.28.209:4102', // what undici actually sent as Host
      'x-forwarded-host': `${LABEL}.${BASE}`,
      [PREVIEW_PEER_FORWARD_HEADER]: '1', // loop guard: owner must serve, not re-forward
    });
    await mw(req, mockRes(), next);
    expect(next.called).toBe(false);
    expect(lastUrl).toBe('http://127.0.0.1:3000/');
  });

  it('still defers when neither Host nor XFH is under the preview base (not preview-shaped)', async () => {
    const mw = createPreviewProxyMiddleware({ portRegistry: registry() });
    const next = mockNext();
    await mw(mockReq('/', { host: '10.0.28.209:4102' }), mockRes(), next);
    expect(next.called).toBe(true);
    expect(lastUrl).toBeUndefined();
  });
});

describe('deployProxy subdomain — label resolution reads the externally-visible host', () => {
  beforeEach(() => {
    process.env.ANT_PREVIEW_BASE_DOMAIN = BASE;
    process.env.ANT_DEPLOY_BASE_DOMAIN = DEPLOY_BASE;
  });
  afterEach(() => {
    delete process.env.ANT_PREVIEW_BASE_DOMAIN;
    delete process.env.ANT_DEPLOY_BASE_DOMAIN;
  });

  it('resolves the deploy label from XFH when Host is the pod ip:port', async () => {
    const resolveLabel = vi.fn(async () => null); // resolution path is what we lock; miss → next()
    const deps: any = {
      ensureRunning: vi.fn(), touchDeploy: vi.fn(), updateDeploy: vi.fn(),
      broadcastStatus: vi.fn(), resolveLabel, resolveCustomDomain: vi.fn(async () => null),
    };
    const mw = createDeployProxyMiddleware(deps);
    const next = mockNext();
    await mw(mockReq('/', { host: '10.0.28.209:4102', 'x-forwarded-host': `${LABEL}.${DEPLOY_BASE}` }), mockRes(), next);
    expect(resolveLabel).toHaveBeenCalledWith(LABEL);
    expect(next.called).toBe(true);
  });
});
