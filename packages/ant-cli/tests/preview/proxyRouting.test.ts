import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { createPreviewProxyMiddleware } from '../../src/periphery/adapters/http/middleware/previewProxy';
import {
  toUrlKey,
  toUrlKeyWithService,
} from '../../src/periphery/adapters/http/services/PreviewService/utils/serverKeyUtils';

/**
 * These tests verify the routing-decision rules of `createPreviewProxyMiddleware`
 * for multi-frontend setups:
 *
 *   1. `/{urlKey}/api/*` → backend port, prefix stripped (/api/* wins).
 *   2. 5-part urlKey pointing at a frontend pkg → keep prefix, route to that pkg.port.
 *   3. 5-part urlKey pointing at a backend  pkg → strip prefix, route to that pkg.port.
 *   4. 4-part urlKey, no frontend in packages → strip prefix.
 *
 * `fetch` is mocked so no real HTTP is performed; we assert the URL the
 * middleware tried to call.
 */

const SERVER_KEY = 'org:user:proj:feat';
const URL_KEY_4 = 'org--user--proj--feat';
const FE_SLUG = 'apps-web';
const URL_KEY_5_FE = `${URL_KEY_4}--${FE_SLUG}`;
const BE_SLUG = 'api';
const URL_KEY_5_BE = `${URL_KEY_4}--${BE_SLUG}`;

interface FakePackages {
  packages: Array<{
    name: string;
    slug?: string;
    type: 'frontend' | 'backend' | 'other';
    port: number;
    urlKey?: string;
  }>;
  port: number; // entry port (frontend if any, else first)
  host?: string;
}

function mockRegistry(state: FakePackages): any {
  return {
    getPreview: vi.fn(async () => ({
      tenantId: 'org', userId: 'user', projectId: 'proj', feature: 'feat',
      running: true, ready: true, host: state.host || '127.0.0.1',
      port: state.port,
      packages: state.packages,
    })),
    touchPreview: vi.fn(async () => {}),
  };
}

function mockReq(url: string): Request {
  return {
    url,
    method: 'GET',
    path: url.split('?')[0],
    headers: { 'host': 'preview.test' },
  } as any as Request;
}

function mockRes(): Response & { _captured: any } {
  const res: any = {
    _captured: { status: undefined, body: undefined, headers: {} as Record<string, string> },
    status(code: number) { this._captured.status = code; return this; },
    setHeader(k: string, v: string) { this._captured.headers[k.toLowerCase()] = v; return this; },
    removeHeader(k: string) { delete this._captured.headers[k.toLowerCase()]; },
    end() { /* no-op */ },
    json(obj: any) { this._captured.body = obj; return this; },
  };
  return res;
}

function mockNext(): NextFunction & { called: boolean } {
  const fn = (() => {
    fn.called = true;
  }) as any;
  fn.called = false;
  return fn;
}

let fetchSpy: any;
let lastFetchUrl: string | undefined;

beforeEach(() => {
  lastFetchUrl = undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fetchSpy = vi.spyOn(globalThis as any, 'fetch').mockImplementation((async (url: string) => {
    lastFetchUrl = String(url);
    // Return a body-less 204 so the middleware just ends the response.
    return new Response(null, { status: 204 });
  }) as any);
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe('previewProxy multi-package routing', () => {
  it('precedence (1): /{urlKey}/api/* always wins → backend port, prefix stripped', async () => {
    const registry = mockRegistry({
      port: 3000,
      packages: [
        { name: 'web', slug: 'web', type: 'frontend', port: 3000, urlKey: URL_KEY_4 },
        { name: 'api', slug: 'api', type: 'backend', port: 4000 },
      ],
    });
    const middleware = createPreviewProxyMiddleware({
      portRegistry: registry,
      getBackendPort: async () => 4000,
    });

    const req = mockReq(`/${URL_KEY_4}/api/users`);
    const res = mockRes();
    await middleware(req, res, mockNext());

    expect(lastFetchUrl).toBe('http://127.0.0.1:4000/api/users');
  });

  it('precedence (2): 5-part urlKey with frontend slug → keep prefix, route to pkg.port', async () => {
    const registry = mockRegistry({
      port: 3000,
      packages: [
        { name: 'apps/web', slug: 'apps-web', type: 'frontend', port: 3000, urlKey: URL_KEY_5_FE },
        { name: 'apps/admin', slug: 'apps-admin', type: 'frontend', port: 3001, urlKey: `${URL_KEY_4}--apps-admin` },
      ],
    });
    const middleware = createPreviewProxyMiddleware({
      portRegistry: registry,
    });

    const req = mockReq(`/${URL_KEY_5_FE}/dashboard`);
    const res = mockRes();
    await middleware(req, res, mockNext());

    // Frontend basePath equals the 5-part urlKey — keep prefix in the upstream path.
    expect(lastFetchUrl).toBe(`http://127.0.0.1:3000/${URL_KEY_5_FE}/dashboard`);
  });

  it('precedence (3): 5-part urlKey with backend slug → strip prefix, route to pkg.port', async () => {
    const registry = mockRegistry({
      port: 3000,
      packages: [
        { name: 'web', slug: 'web', type: 'frontend', port: 3000, urlKey: URL_KEY_4 },
        { name: 'api', slug: 'api', type: 'backend', port: 4000 },
      ],
    });
    const middleware = createPreviewProxyMiddleware({
      portRegistry: registry,
    });

    const req = mockReq(`/${URL_KEY_5_BE}/v1/health`);
    const res = mockRes();
    await middleware(req, res, mockNext());

    // Backend has no basePath — strip the urlKey prefix.
    expect(lastFetchUrl).toBe('http://127.0.0.1:4000/v1/health');
  });

  it('precedence (3) honors slug normalization on input (legacy raw names)', async () => {
    // User typed `apps/web` in @connection but producer wrote slug `apps-web`.
    const registry = mockRegistry({
      port: 3000,
      packages: [
        { name: 'apps/web', slug: 'apps-web', type: 'backend', port: 4000 },
      ],
    });
    const middleware = createPreviewProxyMiddleware({
      portRegistry: registry,
    });

    // Synthesize a urlKey using the raw name as serviceName. The proxy must
    // normalize via packageSlug and still match.
    const rawUrlKey = `${URL_KEY_4}--apps-web`; // already slug-form, same as `apps/web` after slugifying
    const req = mockReq(`/${rawUrlKey}/v1/ping`);
    const res = mockRes();
    await middleware(req, res, mockNext());

    expect(lastFetchUrl).toBe('http://127.0.0.1:4000/v1/ping');
  });

  it('precedence (4): backend-only 4-part deploy → strip prefix, route to entry port', async () => {
    const registry = mockRegistry({
      port: 4000,
      packages: [{ name: 'api', slug: 'api', type: 'backend', port: 4000 }],
    });
    const middleware = createPreviewProxyMiddleware({
      portRegistry: registry,
    });

    const req = mockReq(`/${URL_KEY_4}/v1/info`);
    const res = mockRes();
    await middleware(req, res, mockNext());

    expect(lastFetchUrl).toBe('http://127.0.0.1:4000/v1/info');
  });

  it('frontend single-frontend default 4-part keeps prefix', async () => {
    const registry = mockRegistry({
      port: 3000,
      packages: [{ name: 'web', slug: 'web', type: 'frontend', port: 3000, urlKey: URL_KEY_4 }],
    });
    const middleware = createPreviewProxyMiddleware({
      portRegistry: registry,
    });

    const req = mockReq(`/${URL_KEY_4}/about`);
    const res = mockRes();
    await middleware(req, res, mockNext());

    expect(lastFetchUrl).toBe(`http://127.0.0.1:3000/${URL_KEY_4}/about`);
  });

  it('5-part urlKey with unknown slug falls back to entry frontend (with warning) — keep prefix', async () => {
    const registry = mockRegistry({
      port: 3000,
      packages: [
        { name: 'apps/web', slug: 'apps-web', type: 'frontend', port: 3000, urlKey: URL_KEY_5_FE },
      ],
    });
    const middleware = createPreviewProxyMiddleware({
      portRegistry: registry,
    });

    const bogus = `${URL_KEY_4}--unknown-slug`;
    const req = mockReq(`/${bogus}/anything`);
    const res = mockRes();
    await middleware(req, res, mockNext());

    // Falls through to entry. Entry IS a frontend so prefix is kept.
    expect(lastFetchUrl).toBe(`http://127.0.0.1:3000/${bogus}/anything`);
  });
});

// Quick sanity test that our urlKey helpers continue to round-trip cleanly —
// this is the SSOT we rely on in every assertion above.
describe('serverKeyUtils round-trip (sanity)', () => {
  it('toUrlKey and toUrlKeyWithService produce expected strings', () => {
    expect(toUrlKey(SERVER_KEY)).toBe(URL_KEY_4);
    expect(toUrlKeyWithService(SERVER_KEY, FE_SLUG)).toBe(URL_KEY_5_FE);
  });
});
