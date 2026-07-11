/**
 * Regression: the preview proxy SUBDOMAIN branch must SELF-HEAL when the
 * recorded owner is unreachable cross-pod — rehydrate the dev server on THIS
 * pod (spawn-only, from the shared EFS workspace via `ensureRunning`) and serve
 * locally — instead of dead-ending in a 502.
 *
 * Root incident (preview-502-validated-hartmanis): in a multi-replica cloud
 * deployment a preview dev server lives only on the pod that spawned it, and
 * pod-to-pod on the service port is not guaranteed. When a view request landed
 * on a non-owner pod, owner-forward's 1s liveness probe failed and the proxy
 * returned `{"error":"Preview owner pod unreachable — cross-pod networking
 * blocked"}`. This converges preview onto deploy's ensureRunning+rehydrate model
 * (owner-forward stays a best-effort fast path; unreachable → rehydrate locally).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import * as os from 'os';
import { createPreviewProxyMiddleware } from '../../src/periphery/adapters/http/middleware/previewProxy';

const COORDS = { tenantId: 'org', userId: 'user', projectId: 'proj', feature: 'feat' };
const LABEL = 'org--user--proj--feat';
// A port nothing listens on → the owner-forward liveness probe (state.host:PORT)
// fails fast with ECONNREFUSED, driving the unreachable → rehydrate branch.
const DEAD_SERVICE_PORT = '59991';

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
    end() { this.headersSent = true; },
    json(o: any) { this._c.body = o; this.headersSent = true; return this; },
  };
  return res;
}
const next = (): NextFunction & { called: boolean } => {
  const fn: any = () => { fn.called = true; }; fn.called = false; return fn;
};

// A non-owner record: podId is some OTHER replica, host routable → owner-forward
// fires; the probe to host:DEAD_SERVICE_PORT then fails → rehydrate path.
const staleMatch = () => ({
  ...COORDS,
  host: '127.0.0.1',
  port: 4000,
  podId: 'ant-preview-other-replica',
  packages: [{ slug: 'web', type: 'frontend', port: 4000, urlKey: LABEL }],
});
// Healed record after rehydrate on THIS pod (local owner, fresh port serving).
const healedState = () => ({
  ...COORDS,
  host: '127.0.0.1',
  port: 5000,
  podId: os.hostname(),
  packages: [{ slug: 'web', type: 'frontend', port: 5000, urlKey: LABEL }],
});

describe('previewProxy subdomain branch self-heal', () => {
  const prevPrev = process.env.ANT_PREVIEW_BASE_DOMAIN;
  const prevPort = process.env.PORT;
  let fetchSpy: any;

  beforeEach(() => {
    process.env.ANT_PREVIEW_BASE_DOMAIN = 'ant-preview.test';
    process.env.PORT = DEAD_SERVICE_PORT;
  });
  afterEach(() => {
    if (prevPrev === undefined) delete process.env.ANT_PREVIEW_BASE_DOMAIN; else process.env.ANT_PREVIEW_BASE_DOMAIN = prevPrev;
    if (prevPort === undefined) delete process.env.PORT; else process.env.PORT = prevPort;
    vi.restoreAllMocks();
  });

  it('rehydrates on this pod and serves locally when the cross-pod owner is unreachable — no 502', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockImplementation(async (url: any) => {
      if (String(url).includes(':5000')) return { status: 200, headers: new Headers(), body: null } as any;
      throw new Error('stale-or-dead-target');
    });

    const ensureRunning = vi.fn().mockResolvedValue(healedState());
    const portRegistry: any = {
      listPreviews: vi.fn(async () => [staleMatch()]),
      touchPreview: vi.fn(async () => {}),
    };

    const mw = createPreviewProxyMiddleware({ portRegistry, ensureRunning });

    const req = mkReq('/', `${LABEL}.ant-preview.test`);
    const res = mkRes();
    const nx = next();
    await mw(req, res, nx);

    expect(nx.called).toBe(false);
    // Owner unreachable → rehydrated on this pod exactly once.
    expect(ensureRunning).toHaveBeenCalledWith(COORDS);
    // Final serving fetch went to the healed local port, NOT a cross-pod forward.
    expect(fetchSpy.mock.calls.at(-1)?.[0]).toBe('http://127.0.0.1:5000/');
    expect(res._c.status).not.toBe(502);
  });

  it('502s only when rehydrate cannot recover (ensureRunning returns null)', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockRejectedValue(new Error('dead'));
    const ensureRunning = vi.fn().mockResolvedValue(null);
    const portRegistry: any = {
      listPreviews: vi.fn(async () => [staleMatch()]),
      touchPreview: vi.fn(async () => {}),
    };

    const mw = createPreviewProxyMiddleware({ portRegistry, ensureRunning });

    const req = mkReq('/', `${LABEL}.ant-preview.test`);
    const res = mkRes();
    await mw(req, res, next());

    expect(ensureRunning).toHaveBeenCalledWith(COORDS);
    expect(res._c.status).toBe(502);
    // Diagnostic body: names both pods + the network-layer suspicion so the
    // infra team can grep the evidence straight out of the response.
    expect(res._c.body).toMatchObject({ error: 'Preview owner pod unreachable — cross-pod networking blocked' });
    expect(res._c.body.detail).toContain('pod-to-pod TCP appears blocked');
    expect(res._c.body.detail).toContain('ant-preview-other-replica');
  });
});
