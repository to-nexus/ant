/**
 * Regression suite for the preview local-first self-heal (deploy parity) under
 * blocked pod-to-pod networking.
 *
 * Root incident (2026-07-11 502/504 recurrence): every pod probed every other
 * pod's service/dev ports as unreachable (network-layer block), and preview's
 * rehydrate-locally fallback — unlike deploy's — had three defects:
 *   (a) lock-miss returned the STALE cross-pod Redis record verbatim → the
 *       proxy burned 6 transport retries against a blocked target → 502/504;
 *   (b) ensureRunning returned before the dev server was listening (health
 *       check was fire-and-forget);
 *   (c) after another pod's rehydrate REPLACE'd the shared record, a pod with
 *       a healthy local vite could no longer reach it (its ports lived only
 *       in the overwritten record).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as net from 'net';
import type { Request, Response, NextFunction } from 'express';
import { PreviewService } from '../../src/periphery/adapters/http/services/PreviewService/PreviewService';
import { createPreviewProxyMiddleware } from '../../src/periphery/adapters/http/middleware/previewProxy';
import { REDIS_KEYS } from '../../src/core/constants/redis';

const HOST = os.hostname();
const COORDS = { tenantId: 'org', userId: 'user', projectId: 'proj', feature: 'feat' } as const;
const KEY = 'org:user:proj:feat';
// Nothing listens here → cross-pod liveness probe fails fast (ECONNREFUSED).
const DEAD_PORT = 1;

function record(over: Partial<any> = {}): any {
  return {
    ...COORDS,
    running: true, ready: true, port: 30000, host: '127.0.0.1', podId: HOST,
    phase: 'running', packages: [{ name: 'app', slug: 'app', type: 'frontend', port: 30000 }],
    connections: [], issues: [],
    startedAt: new Date(), lastAccessedAt: new Date(),
    ...over,
  };
}

function makeStateStoreStub(): any {
  return {
    publish: vi.fn(async () => undefined),
    listPreviews: vi.fn(async () => []),
    acquireLock: vi.fn(async () => true),
    releaseLock: vi.fn(async () => undefined),
    getPreviewConfig: vi.fn(async () => null),
  };
}

function makeRedisStub(current: any): any {
  return {
    getPreview: vi.fn(async () => current),
    unregisterPreview: vi.fn(async () => undefined),
    updatePreview: vi.fn(async () => undefined),
    listPreviews: vi.fn(async () => (current ? [current] : [])),
    listPreviewsByPod: vi.fn(async () => []),
    touchPreview: vi.fn(async () => undefined),
  };
}

/** Seed a service that "runs" the preview locally (live handle + local facts). */
function seedLocal(svc: PreviewService, local: any): void {
  (svc as any).previewServers.set(KEY, [{ pid: 4242, killed: false, exitCode: null }]);
  (svc as any).localPreviews.set(KEY, local);
}

function neuterProcessOps(svc: PreviewService): void {
  (svc as any).infrastructureManager = { stopInfrastructure: vi.fn(async () => undefined) };
  (svc as any).processSpawner.killAndWait = vi.fn(async () => undefined);
  (svc as any).dev.killOwned = vi.fn(async () => undefined);
  (svc as any).dev.cleanupStaleLocks = vi.fn(async () => undefined);
}

describe('PreviewService.ensureRunning — local-first', () => {
  it('returns the pod-local spawn facts when the Redis record was REPLACE-stolen by another pod (no startPreview)', async () => {
    const stolen = record({ podId: 'other-pod', host: '10.0.0.9', port: 31111, packages: [{ name: 'app', slug: 'app', type: 'frontend', port: 31111 }] });
    const redis = makeRedisStub(stolen);
    const svc = new PreviewService(undefined, redis, undefined, makeStateStoreStub());
    const local = record({ port: 30500, packages: [{ name: 'app', slug: 'app', type: 'frontend', port: 30500 }] });
    seedLocal(svc, local);
    const startSpy = vi.spyOn(svc, 'startPreview');

    const result = await svc.ensureRunning(COORDS.tenantId, COORDS.userId, COORDS.projectId, COORDS.feature, '/ws');

    expect(startSpy).not.toHaveBeenCalled();
    expect(result?.podId).toBe(HOST);
    expect(result?.port).toBe(30500); // local facts, not the stolen record's 31111
  });

  it('awaits the pending health check before returning (readiness gate)', async () => {
    const redis = makeRedisStub(null);
    const svc = new PreviewService(undefined, redis, undefined, makeStateStoreStub());
    seedLocal(svc, record({ ready: false, phase: 'starting' }));
    let resolveReady!: (v: boolean) => void;
    (svc as any).pendingReadiness.set(KEY, new Promise<boolean>((r) => { resolveReady = r; }));

    let settled = false;
    const pending = svc.ensureRunning(COORDS.tenantId, COORDS.userId, COORDS.projectId, COORDS.feature, '/ws')
      .then((r) => { settled = true; return r; });

    await new Promise((r) => setTimeout(r, 25));
    expect(settled).toBe(false); // must NOT return while the dev server is still starting

    resolveReady(true);
    const result = await pending;
    expect(result).toBeTruthy();
  });

  it('NEVER returns a cross-pod record whose target fails the liveness probe (stale-record 502 regression)', async () => {
    const stale = record({ podId: 'other-pod', host: '127.0.0.1', port: DEAD_PORT, packages: [{ name: 'app', slug: 'app', type: 'frontend', port: DEAD_PORT }] });
    const redis = makeRedisStub(stale);
    const svc = new PreviewService(undefined, redis, undefined, makeStateStoreStub());
    // Rehydrate cannot produce a local instance (e.g. start failed).
    const startSpy = vi.spyOn(svc, 'startPreview').mockResolvedValue({ success: false, error: 'lock' } as any);

    const result = await svc.ensureRunning(COORDS.tenantId, COORDS.userId, COORDS.projectId, COORDS.feature, '/ws');

    expect(result).toBeNull();
    // Rehydrate takes the POD-scoped lock so pods don't exclude each other.
    expect(startSpy).toHaveBeenCalledWith(
      COORDS.tenantId, COORDS.userId, COORDS.projectId, COORDS.feature, '/ws',
      undefined, false, { lockScope: 'pod' },
    );
  });

  it('trusts a cross-pod record when its dev-server port IS reachable (owner-forward world)', async () => {
    const srv = net.createServer(() => { /* accept */ });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const livePort = (srv.address() as net.AddressInfo).port;
    try {
      const crossPod = record({ podId: 'other-pod', host: '127.0.0.1', port: livePort, packages: [{ name: 'app', slug: 'app', type: 'frontend', port: livePort }] });
      const redis = makeRedisStub(crossPod);
      const svc = new PreviewService(undefined, redis, undefined, makeStateStoreStub());
      const startSpy = vi.spyOn(svc, 'startPreview');

      const result = await svc.ensureRunning(COORDS.tenantId, COORDS.userId, COORDS.projectId, COORDS.feature, '/ws');

      expect(startSpy).not.toHaveBeenCalled();
      expect(result).toEqual(crossPod);
    } finally {
      srv.close();
    }
  });

  it('coalesces concurrent rehydrates in-process (single startPreview)', async () => {
    const redis = makeRedisStub(null);
    const svc = new PreviewService(undefined, redis, undefined, makeStateStoreStub());
    const startSpy = vi.spyOn(svc, 'startPreview').mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { success: false, error: 'stub' } as any;
    });

    await Promise.all([
      svc.ensureRunning(COORDS.tenantId, COORDS.userId, COORDS.projectId, COORDS.feature, '/ws'),
      svc.ensureRunning(COORDS.tenantId, COORDS.userId, COORDS.projectId, COORDS.feature, '/ws'),
      svc.ensureRunning(COORDS.tenantId, COORDS.userId, COORDS.projectId, COORDS.feature, '/ws'),
    ]);

    expect(startSpy).toHaveBeenCalledTimes(1);
  });
});

describe('PreviewService — ownership flip is harmless to a live local instance', () => {
  let svc: PreviewService;
  let redis: any;
  let stateStore: any;

  beforeEach(() => {
    // Shared record REPLACE-stolen by another pod.
    redis = makeRedisStub(record({ podId: 'other-pod', host: '10.0.0.9', port: 31111 }));
    stateStore = makeStateStoreStub();
    svc = new PreviewService(
      { release: vi.fn(), allocate: vi.fn(), dispose: vi.fn() } as any,
      redis, undefined, stateStore,
    );
    neuterProcessOps(svc);
    seedLocal(svc, record({ port: 30500, packages: [{ name: 'app', slug: 'app', type: 'frontend', port: 30500, pid: 4242, pgid: 4242, podId: HOST }] }));
  });

  it('getLocalPreview still resolves after the record flip', () => {
    const local = svc.getLocalPreview(COORDS.tenantId, COORDS.userId, COORDS.projectId, COORDS.feature);
    expect(local?.port).toBe(30500);
    expect(local?.podId).toBe(HOST);
  });

  it('a LOCAL-ONLY stop does not unregister the other pod\'s record (restart-race guard)', async () => {
    await svc.stopPreview(COORDS.tenantId, COORDS.userId, COORDS.projectId, COORDS.feature, { skipFanout: true });
    expect(redis.unregisterPreview).not.toHaveBeenCalled();
  });

  it('the idle check visits an orphaned local instance (record deleted elsewhere) instead of skipping it', async () => {
    redis.getPreview = vi.fn(async () => null);
    stateStore.listPreviews = vi.fn(async () => []); // record gone from the registry
    (svc as any).spawnTimestamps.set(KEY, Date.now() - 10 * 60 * 1000); // past the grace window
    const stopSpy = vi.spyOn(svc, 'stopPreview').mockResolvedValue({ success: true } as any);

    await (svc as any).checkIdleInstances();

    expect(stopSpy).toHaveBeenCalledWith(
      COORDS.tenantId, COORDS.userId, COORDS.projectId, COORDS.feature, { skipFanout: true },
    );
  });

  it('a freshly-spawned orphan is NOT reaped inside the grace window (forceRestart race guard)', async () => {
    stateStore.listPreviews = vi.fn(async () => []);
    (svc as any).spawnTimestamps.set(KEY, Date.now() - 5_000);
    const stopSpy = vi.spyOn(svc, 'stopPreview').mockResolvedValue({ success: true } as any);

    await (svc as any).checkIdleInstances();

    expect(stopSpy).not.toHaveBeenCalled();
  });
});

describe('PreviewService — stop fan-out', () => {
  const previewStopCalls = (publish: any) =>
    publish.mock.calls.filter((c: any[]) => c[0] === REDIS_KEYS.LIFECYCLE.CLEANUP_REQUEST && c[1]?.scope === 'preview-stop');

  function makeSvc(current: any) {
    const redis = makeRedisStub(current);
    const stateStore = makeStateStoreStub();
    const svc = new PreviewService(undefined, redis, undefined, stateStore);
    neuterProcessOps(svc);
    return { svc, redis, stateStore };
  }

  it('a user stop WITH local handles fans out so other pods reap their instances', async () => {
    const { svc, stateStore } = makeSvc(record());
    seedLocal(svc, record());

    await svc.stopPreview(COORDS.tenantId, COORDS.userId, COORDS.projectId, COORDS.feature);

    expect(previewStopCalls(stateStore.publish)).toHaveLength(1);
  });

  it('stopPreviewIfOwned (fan-out receipt) does NOT re-publish (loop guard)', async () => {
    const { svc, stateStore } = makeSvc(record());
    seedLocal(svc, record());

    await svc.stopPreviewIfOwned(COORDS.tenantId, COORDS.userId, COORDS.projectId, COORDS.feature);

    expect(previewStopCalls(stateStore.publish)).toHaveLength(0);
  });
});

describe('previewProxy — local-first serving', () => {
  const LABEL = 'org--user--proj--feat';
  const prevBase = process.env.ANT_PREVIEW_BASE_DOMAIN;
  let fetchSpy: any;

  beforeEach(() => { process.env.ANT_PREVIEW_BASE_DOMAIN = 'ant-preview.test'; });
  afterEach(() => {
    if (prevBase === undefined) delete process.env.ANT_PREVIEW_BASE_DOMAIN; else process.env.ANT_PREVIEW_BASE_DOMAIN = prevBase;
    vi.restoreAllMocks();
  });

  function mkReq(url: string, host: string): Request {
    return { url, method: 'GET', path: url, headers: { host } } as any;
  }
  function mkRes(): Response & { _c: any } {
    const res: any = {
      _c: {}, headersSent: false,
      status(c: number) { this._c.status = c; return this; },
      setHeader() { return this; }, removeHeader() {},
      end() { this.headersSent = true; },
      json(o: any) { this._c.body = o; this.headersSent = true; return this; },
    };
    return res;
  }

  it('serves from the pod-local instance without owner-forward or rehydrate when getLocal resolves', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockImplementation(async (url: any) => {
      if (String(url).includes(':30500')) return { status: 200, headers: new Headers(), body: null } as any;
      throw new Error(`unexpected fetch target: ${url}`);
    });
    // Shared record points at ANOTHER pod — without local-first this would
    // probe + owner-forward (and fail under blocked networking).
    const stolen = {
      ...COORDS, host: '10.0.0.9', port: 31111, podId: 'other-pod',
      packages: [{ slug: 'app', type: 'frontend', port: 31111, urlKey: LABEL }],
    };
    const local = {
      ...COORDS, host: '127.0.0.1', port: 30500, podId: HOST, running: true, ready: true,
      packages: [{ slug: 'app', type: 'frontend', port: 30500, urlKey: LABEL }],
    };
    const ensureRunning = vi.fn();
    const portRegistry: any = {
      // Index-only label resolution (M-NEW-020).
      getPreviewByLabel: vi.fn(async () => stolen),
      listPreviews: vi.fn(async () => [stolen]),
      touchPreview: vi.fn(async () => {}),
    };

    const mw = createPreviewProxyMiddleware({ portRegistry, ensureRunning, getLocal: () => local as any });
    const res = mkRes();
    await mw(mkReq('/', `${LABEL}.ant-preview.test`), res, (() => {}) as NextFunction);

    expect(ensureRunning).not.toHaveBeenCalled();
    expect(fetchSpy.mock.calls.at(-1)?.[0]).toBe('http://127.0.0.1:30500/');
    expect(res._c.status).not.toBe(502);
  });
});
