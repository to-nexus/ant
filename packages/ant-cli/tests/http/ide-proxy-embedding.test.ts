/**
 * Who may embed the IDE — `frame-ancestors` on `/ide/*` responses.
 *
 * Defense in depth for the nav-ticket lane, NOT the control that admits a
 * request (that is the gate — see `ide-gate-admission.test.ts`). It matters
 * because `helmet` runs with `frameguard: false` and this proxy strips the
 * upstream's `X-Frame-Options`, so without it nothing bounds who frames a live
 * IDE — including a user's own deployed page, which is same-site.
 *
 * The allowlist is the same source the origin predicate reads, so the two
 * cannot drift.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import http from 'node:http';

import { createIDEKey } from '../../src/infrastructure/state/redisKeyUtils';

let upstreamCsp: string | undefined;

vi.mock('../../src/infrastructure/adapters/InfrastructureFactory', () => ({
  getInfrastructureFactory: () => ({
    getStateStore: () => ({ getIDE: async () => ({ host: '127.0.0.1' }) }),
  }),
}));

const { createIDEProxyMiddleware } = await import('../../src/periphery/adapters/http/middleware/ideProxy');

const KEY = createIDEKey('acme', 'u1', 'shop', 'main');
const FE = 'https://app.example.com';

describe('/ide/* frame-ancestors', () => {
  let upstream: http.Server;
  let proxy: http.Server;
  let baseUrl: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(async () => {
    saved.FRONTEND_URL = process.env.FRONTEND_URL;
    saved.ANT_CORS_ORIGINS = process.env.ANT_CORS_ORIGINS;
    saved.ANT_SERVER_MODE = process.env.ANT_SERVER_MODE;
    process.env.FRONTEND_URL = FE;
    process.env.ANT_SERVER_MODE = 'cloud';
    delete process.env.ANT_CORS_ORIGINS;
    upstreamCsp = undefined;

    upstream = http.createServer((_req, res) => {
      if (upstreamCsp) res.setHeader('content-security-policy', upstreamCsp);
      res.setHeader('x-frame-options', 'SAMEORIGIN');
      res.end('workbench');
    });
    await new Promise<void>(r => { upstream.listen(0, () => r()); });
    const upstreamPort = (upstream.address() as any).port;

    const app = express();
    app.use(createIDEProxyMiddleware({
      portRegistry: { getIDEPort: async () => upstreamPort, touchIDE: async () => {} } as any,
      pathPrefix: '/ide',
    }));
    await new Promise<void>(r => { proxy = app.listen(0, () => r()); });
    baseUrl = `http://127.0.0.1:${(proxy.address() as any).port}`;
  });

  afterEach(async () => {
    await new Promise<void>(r => proxy.close(() => r()));
    await new Promise<void>(r => upstream.close(() => r()));
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  const csp = async () =>
    (await fetch(`${baseUrl}/ide/${KEY}/`)).headers.get('content-security-policy');

  it('names self and the registered frontend origin', async () => {
    expect(await csp()).toBe(`frame-ancestors 'self' ${FE}`);
  });

  it('includes every extra registered origin', async () => {
    process.env.ANT_CORS_ORIGINS = 'https://a.example.com, https://b.example.com';
    expect(await csp()).toBe(`frame-ancestors 'self' ${FE} https://a.example.com https://b.example.com`);
  });

  it('allows loopback by pattern outside cloud — it is prefix-matched, not enumerable', async () => {
    process.env.ANT_SERVER_MODE = 'local';
    expect(await csp()).toContain('http://localhost:*');
  });

  it('never emits the CORS wildcard as an embedder', async () => {
    process.env.ANT_CORS_ORIGINS = '*';
    expect(await csp()).toBe(`frame-ancestors 'self' ${FE}`);
  });

  it('wins over a policy the upstream IDE sends', async () => {
    upstreamCsp = "frame-ancestors *";
    expect(await csp()).toBe(`frame-ancestors 'self' ${FE}`);
  });
});
