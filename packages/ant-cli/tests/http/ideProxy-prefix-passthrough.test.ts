/**
 * Regression — IDE proxy must NOT strip `/ide/<key>` before forwarding.
 *
 * openvscode-server runs with `--server-base-path /ide/<key>` (see
 * KubernetesIDEOrchestrator.ts / IDEService.ts), so Express routes are
 * mounted UNDER the prefix. If the proxy strips the prefix the upstream
 * receives unmatched paths and returns 500 for every static asset
 * (nls.messages.js / workbench.js — the exact user-visible failure).
 *
 * This test locks two contracts:
 *   1) BaseProxyMiddleware.stripPrefix() default behaviour is still STRIP
 *      (so dev/preview consumers that serve at root keep working).
 *   2) IDEProxyMiddlewareImpl overrides stripPrefix() to FALSE and the
 *      middleware forwards `req.url` verbatim — prefix-intact — upstream.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import {
  BaseProxyMiddleware,
  BaseProxyConfig,
  ServerKeyParts,
} from '../../src/periphery/adapters/http/middleware/baseProxy';

class TestProxy extends BaseProxyMiddleware {
  public lastTargetUrl: string | undefined;
  private stripFlag: boolean;

  constructor(config: BaseProxyConfig, stripFlag: boolean) {
    super(config);
    this.stripFlag = stripFlag;
  }

  protected stripPrefix(): boolean {
    return this.stripFlag;
  }

  protected parseServerKey(serverKey: string): ServerKeyParts | null {
    const parts = serverKey.split(':');
    if (parts.length !== 4) return null;
    return {
      tenantId: parts[0],
      userId: parts[1],
      projectId: parts[2],
      feature: parts[3],
      serverKey,
    };
  }

  protected async getPort(): Promise<number | null> {
    return 3000;
  }

  protected async getHost(): Promise<string> {
    return '10.0.0.5';
  }

  protected async updateLastAccess(): Promise<void> {
    // no-op
  }

  protected getRegistryType(): 'dev-server' | 'ide' {
    return 'ide';
  }
}

function mockReqRes(url: string) {
  const req: any = { url, path: url.split('?')[0], method: 'GET', headers: { host: 'ant-server.crosstoken.io' } };
  const res: any = {
    statusCode: 200,
    headersSent: false,
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return { req, res };
}

describe('IDE proxy prefix passthrough', () => {
  const fakePortRegistry = {
    getIDEPort: vi.fn().mockResolvedValue(3000),
    touchIDE: vi.fn().mockResolvedValue(undefined),
  } as any;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('default stripPrefix=true strips `/ide/<key>` before forwarding (dev/preview default contract)', async () => {
    const proxy = new TestProxy(
      { portRegistry: fakePortRegistry, pathPrefix: '/ide', componentName: 'TestProxy' },
      true,
    );
    let capturedUrl: string | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      capturedUrl = String(url);
      return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } });
    });

    const middleware = proxy.createMiddleware();
    const { req, res } = mockReqRes('/ide/org:user:proj:base/stable-abcdef/static/out/nls.messages.js');
    await middleware(req as any, res as any, (() => {}) as any);

    expect(capturedUrl).toBe('http://10.0.0.5:3000/stable-abcdef/static/out/nls.messages.js');
  });

  it('stripPrefix=false forwards `req.url` verbatim — `/ide/<key>` reaches upstream (IDE contract)', async () => {
    const proxy = new TestProxy(
      { portRegistry: fakePortRegistry, pathPrefix: '/ide', componentName: 'TestProxy' },
      false,
    );
    let capturedUrl: string | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      capturedUrl = String(url);
      return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } });
    });

    const middleware = proxy.createMiddleware();
    const { req, res } = mockReqRes('/ide/org:user:proj:base/stable-abcdef/static/out/nls.messages.js');
    await middleware(req as any, res as any, (() => {}) as any);

    expect(capturedUrl).toBe(
      'http://10.0.0.5:3000/ide/org:user:proj:base/stable-abcdef/static/out/nls.messages.js',
    );
  });

  it('stripPrefix=false preserves the prefix on root requests too (`/ide/<key>/`)', async () => {
    const proxy = new TestProxy(
      { portRegistry: fakePortRegistry, pathPrefix: '/ide', componentName: 'TestProxy' },
      false,
    );
    let capturedUrl: string | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      capturedUrl = String(url);
      return new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    });

    const middleware = proxy.createMiddleware();
    const { req, res } = mockReqRes('/ide/org:user:proj:base/?folder=/workspace');
    await middleware(req as any, res as any, (() => {}) as any);

    expect(capturedUrl).toBe('http://10.0.0.5:3000/ide/org:user:proj:base/?folder=/workspace');
  });
});

describe('IDEProxyMiddlewareImpl.stripPrefix() contract', () => {
  it('IDE proxy factory returns a middleware whose underlying stripPrefix() is false', async () => {
    // Direct verification: the production IDE proxy is built by createIDEProxyMiddleware
    // and its subclass must override stripPrefix() to false. We assert at the source-level
    // by re-reading the module's exported impl shape — sanity guard against a future
    // override removal.
    const src = await import('node:fs/promises').then(fs =>
      fs.readFile(
        new URL('../../src/periphery/adapters/http/middleware/ideProxy.ts', import.meta.url),
        'utf8',
      ),
    );

    // Must contain the override that returns false (not just the default).
    expect(src).toMatch(/protected\s+stripPrefix\s*\(\s*\)\s*:\s*boolean\s*\{\s*[^]*?return\s+false;/);

    // WS handler must NOT slice the prefix off `req.url` anymore — preserving
    // the prefix for openvscode-server upgrade routing.
    expect(src).not.toMatch(/url\.slice\(\s*`?\$\{?pathPrefix\}?\/\$?\{?serverKey\}?`?\.length\)/);
  });
});

// Express test helper to silence unused-import error in some setups.
void express;
