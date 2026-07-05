/**
 * Phase 2: subdomain routing (flag ON) — previewProxy Host→label resolution,
 * root-verbatim forwarding, /api→backend, non-matching-host deferral; config
 * SSOT; DeployService.resolveDeployLabel.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { createPreviewProxyMiddleware } from '../../src/periphery/adapters/http/middleware/previewProxy';
import {
  getPreviewRoutingMode,
  isSubdomainRouting,
  getPreviewBaseDomain,
  getDeployBaseDomain,
} from '../../src/core/config/previewRouting';

const BASE = 'ant-preview.test';
const SERVER = { tenantId: 'org', userId: 'user', projectId: 'proj', feature: 'feat' };
const LABEL = 'org--user--proj--feat'; // toDnsLabel of the 4-part urlKey

function mockRegistry(packages: any[], port = 3000, host = '127.0.0.1'): any {
  return {
    listPreviews: vi.fn(async () => [{ ...SERVER, host, port, packages }]),
    touchPreview: vi.fn(async () => {}),
  };
}
function mockReq(url: string, host: string): Request {
  return { url, method: 'GET', path: url.split('?')[0], headers: { host } } as any;
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

let fetchSpy: any;
let lastUrl: string | undefined;

beforeEach(() => {
  // Subdomain routing is driven purely by the base-domain presence.
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

describe('previewRouting config SSOT', () => {
  it('subdomain routing is active when a base domain is configured (presence = switch)', () => {
    expect(getPreviewRoutingMode()).toBe('subdomain');
    expect(isSubdomainRouting()).toBe(true);
    expect(getPreviewBaseDomain()).toBe(BASE);
    // deploy base defaults to `deploy.<previewBase>` when unset
    expect(getDeployBaseDomain()).toBe(`deploy.${BASE}`);
  });
  it('falls back to path mode when no base domain is configured', () => {
    delete process.env.ANT_PREVIEW_BASE_DOMAIN;
    expect(getPreviewRoutingMode()).toBe('path');
    expect(isSubdomainRouting()).toBe(false);
    expect(getDeployBaseDomain()).toBeUndefined();
  });
});

describe('previewProxy subdomain routing', () => {
  it('root-absolute asset forwards VERBATIM (no prefix) to the entry port', async () => {
    const registry = mockRegistry([{ name: 'web', slug: 'web', type: 'frontend', port: 3000, urlKey: LABEL }]);
    const mw = createPreviewProxyMiddleware({ portRegistry: registry });
    const req = mockReq('/images/branch-ochi-1.jpg', `${LABEL}.${BASE}`);
    await mw(req, mockRes(), mockNext());
    // The exact 404-inducing case in path mode now resolves at root, no prefix.
    expect(lastUrl).toBe('http://127.0.0.1:3000/images/branch-ochi-1.jpg');
  });

  it('/api/* routes to the backend port', async () => {
    const registry = mockRegistry([
      { name: 'web', slug: 'web', type: 'frontend', port: 3000, urlKey: LABEL },
      { name: 'api', slug: 'api', type: 'backend', port: 4000 },
    ]);
    const mw = createPreviewProxyMiddleware({ portRegistry: registry, getBackendPort: async () => 4000 });
    const req = mockReq('/api/users', `${LABEL}.${BASE}`);
    await mw(req, mockRes(), mockNext());
    expect(lastUrl).toBe('http://127.0.0.1:4000/api/users');
  });

  it('defers (next) when the Host is not under the preview base domain', async () => {
    const registry = mockRegistry([{ name: 'web', slug: 'web', type: 'frontend', port: 3000, urlKey: LABEL }]);
    const mw = createPreviewProxyMiddleware({ portRegistry: registry });
    const next = mockNext();
    // A deploy subdomain (different base) must not be handled by the preview proxy.
    await mw(mockReq('/x', `${LABEL}.deploy.${BASE}`), mockRes(), next);
    expect(next.called).toBe(true);
    expect(lastUrl).toBeUndefined();
  });

  it('404 when no active preview matches the label', async () => {
    const registry = mockRegistry([{ name: 'web', slug: 'web', type: 'frontend', port: 3000, urlKey: LABEL }]);
    const mw = createPreviewProxyMiddleware({ portRegistry: registry });
    const res = mockRes();
    await mw(mockReq('/', `other--k--e--y.${BASE}`), res, mockNext());
    expect(res._c.status).toBe(404);
  });
});

describe('DeployService.resolveDeployLabel', () => {
  it('matches a deploy label to its coordinates (+ serviceName for 5-part)', async () => {
    const { DeployService } = await import('../../src/infrastructure/deploy/DeployService');
    const stateStore: any = {
      listDeploys: vi.fn(async () => [
        { ...SERVER, packages: [{ slug: 'web', urlKey: 'org--user--proj--feat--web' }] },
      ]),
    };
    const svc = new DeployService({ portManager: {} as any, stateStore });
    const single = await svc.resolveDeployLabel('org--user--proj--feat--web');
    expect(single).toMatchObject({ ...SERVER, serviceName: 'web' });
    const miss = await svc.resolveDeployLabel('no--such--label--here');
    expect(miss).toBeNull();
  });
});
