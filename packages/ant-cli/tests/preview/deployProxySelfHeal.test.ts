/**
 * Regression: the deploy proxy SUBDOMAIN branch must self-heal a stale/dead
 * target exactly like the path branch — mark hibernated, rehydrate on this pod,
 * retry once — instead of dead-ending in a 502.
 *
 * Root incident: after an ant-preview pod roll, a deploy's Redis state still
 * pointed at the previous pod's host:port. The subdomain branch fetched the
 * dead target and returned `{"error":"Deploy server unreachable"}` with no
 * recovery (3/3 attempts 502, ~22s each). The path branch already self-healed;
 * this converges both onto one helper.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { createDeployProxyMiddleware } from '../../src/periphery/adapters/http/middleware/deployProxy';

const COORDS = { tenantId: 'org', userId: 'user', projectId: 'proj', feature: 'feat' };
const LABEL = 'org--user--proj--feat';

function mkReq(url: string, host: string): Request {
  return { url, method: 'GET', path: url, headers: { host } } as any;
}
function mkRes(): Response & { _c: any } {
  const res: any = {
    _c: {},
    headersSent: false,
    status(c: number) { this._c.status = c; return this; },
    setHeader() { return this; },
    removeHeader() {},
    end() {},
    json(o: any) { this._c.body = o; return this; },
  };
  return res;
}
const next = (): NextFunction & { called: boolean } => {
  const fn: any = () => { fn.called = true; }; fn.called = false; return fn;
};

const runningState = (port: number) => ({
  ...COORDS,
  host: '127.0.0.1',
  visibility: 'public',
  packages: [{ slug: 'web', port, kind: 'static', urlKey: LABEL }],
});

describe('deployProxy subdomain branch self-heal', () => {
  const prevBase = process.env.ANT_DEPLOY_BASE_DOMAIN;
  const prevPrev = process.env.ANT_PREVIEW_BASE_DOMAIN;
  let fetchSpy: any;

  beforeEach(() => {
    process.env.ANT_PREVIEW_BASE_DOMAIN = 'ant-preview.test';
    process.env.ANT_DEPLOY_BASE_DOMAIN = 'ant-deploy.test';
  });
  afterEach(() => {
    if (prevBase === undefined) delete process.env.ANT_DEPLOY_BASE_DOMAIN; else process.env.ANT_DEPLOY_BASE_DOMAIN = prevBase;
    if (prevPrev === undefined) delete process.env.ANT_PREVIEW_BASE_DOMAIN; else process.env.ANT_PREVIEW_BASE_DOMAIN = prevPrev;
    vi.restoreAllMocks();
  });

  it('rehydrates and retries when the first (stale) target is unreachable, then serves — no 502', async () => {
    // Route by URL: stale port 4000 is dead (throws), healed port 5000 serves.
    // A non-transport message avoids fetchWithTransportRetry's internal backoff
    // (that layer is tested elsewhere); the self-heal outer catch fires for any
    // thrown error regardless of transport-ness.
    fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockImplementation(async (url: any) => {
      if (String(url).includes(':4000')) throw new Error('stale-target-dead');
      return { status: 200, headers: new Headers(), body: null } as any;
    });

    // ensureRunning: stale state first, healed state (new port) on retry.
    const ensureRunning = vi.fn()
      .mockResolvedValueOnce(runningState(4000)) // initial (stale host:port)
      .mockResolvedValue(runningState(5000));    // after hibernate → re-spawn on this pod
    const updateDeploy = vi.fn(async () => {});
    const broadcastStatus = vi.fn(async () => {});

    const mw = createDeployProxyMiddleware({
      ensureRunning,
      touchDeploy: vi.fn(async () => {}),
      updateDeploy,
      broadcastStatus,
      resolveLabel: vi.fn(async () => ({ ...COORDS })),
      resolveCustomDomain: vi.fn(async () => null),
    });

    const req = mkReq('/dashboard', `${LABEL}.ant-deploy.test`);
    const res = mkRes();
    const nx = next();
    await mw(req, res, nx);

    expect(nx.called).toBe(false);
    // Flipped to hibernated so ensureRunning re-spawns on this pod.
    expect(updateDeploy).toHaveBeenCalledWith('org', 'user', 'proj', 'feat', { phase: 'hibernated' });
    expect(ensureRunning).toHaveBeenCalledTimes(2);
    // Retry hit the healed port; the final serving fetch was to :5000.
    expect(fetchSpy.mock.calls.some((c: any[]) => String(c[0]).includes(':5000'))).toBe(true);
    expect(fetchSpy.mock.calls.at(-1)?.[0]).toBe('http://127.0.0.1:5000/dashboard');
    // No 502, deploy not marked unavailable.
    expect(res._c.status).not.toBe(502);
    expect(broadcastStatus).not.toHaveBeenCalledWith(
      'org', 'user', 'proj', 'feat', expect.objectContaining({ phase: 'unavailable' }),
    );
  });

  it('marks unavailable and 502s only after the rehydrate retry also fails', async () => {
    // Non-transport error → no internal backoff; both proxy attempts throw.
    fetchSpy = vi.spyOn(globalThis, 'fetch' as any)
      .mockRejectedValue(new Error('stale-target-dead'));

    const ensureRunning = vi.fn().mockResolvedValue(runningState(4000));
    const updateDeploy = vi.fn(async () => {});
    const broadcastStatus = vi.fn(async () => {});

    const mw = createDeployProxyMiddleware({
      ensureRunning,
      touchDeploy: vi.fn(async () => {}),
      updateDeploy,
      broadcastStatus,
      resolveLabel: vi.fn(async () => ({ ...COORDS })),
      resolveCustomDomain: vi.fn(async () => null),
    });

    const req = mkReq('/', `${LABEL}.ant-deploy.test`);
    const res = mkRes();
    await mw(req, res, next());

    expect(res._c.status).toBe(502);
    expect(res._c.body).toEqual({ error: 'Deploy server unreachable' });
    expect(updateDeploy).toHaveBeenCalledWith(
      'org', 'user', 'proj', 'feat', expect.objectContaining({ phase: 'unavailable' }),
    );
    expect(broadcastStatus).toHaveBeenCalledWith(
      'org', 'user', 'proj', 'feat', expect.objectContaining({ phase: 'unavailable' }),
    );
  });
});
