import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as os from 'os';
import { PreviewService } from '../../src/periphery/adapters/http/services/PreviewService/PreviewService';

/**
 * Pins the core fix of this PR: preview process cleanup acts ONLY on the
 * ANT-owned process identities persisted for THIS serverKey (scoped to
 * (podId, serverKey)), never an OS port/cwd scan whose bare port number was
 * only pod-local. That scan is what let a stop/restart of project B kill
 * project A when a round-robined request landed on a pod where B's ports
 * happened to collide with A's.
 *
 *   1. stopPreview(B) only ever signals B's recorded process group — A's PID
 *      (never present in B's Redis state) receives ZERO signals.
 *   2. reconcileOwnedPreviews reaps this pod's prior previews by persisted
 *      pgid, releases their port claims, and unregisters them.
 */

const HOST = os.hostname();
const A_PID = 999_000_001; // project A — must never be touched by a B stop
const B_PID = 999_000_002; // project B — recorded owned identity

function previewState(over: Partial<any> = {}): any {
  return {
    tenantId: 'org', userId: 'user', projectId: 'projB', feature: 'main',
    running: true, ready: true, port: 30000, host: '127.0.0.1', podId: HOST,
    phase: 'running', packages: [], connections: [], issues: [],
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

describe('PreviewService — owned-identity cleanup (cross-project safety)', () => {
  let svc: PreviewService;
  let redis: any;
  let stateStore: any;
  let sentSignals: number[];

  beforeEach(() => {
    redis = {
      getPreview: vi.fn(async () => previewState({
        // B owned by THIS pod, handles gone (Node-restart shape) → safety-net
        // reaches for the persisted owned record.
        packages: [{ name: 'app', type: 'frontend', port: 30000, pid: B_PID, pgid: B_PID, podId: HOST }],
      })),
      unregisterPreview: vi.fn(async () => undefined),
      updatePreview: vi.fn(async () => undefined),
      listPreviews: vi.fn(async () => []),
      listPreviewsByPod: vi.fn(async () => []),
    };
    stateStore = makeStateStoreStub();
    svc = new PreviewService(undefined, redis, undefined, stateStore);
    (svc as any).infrastructureManager = { stopInfrastructure: vi.fn(async () => undefined) };
    (svc as any).previewServers = new Map(); // no local handles → owned-record path

    // Spy the low-level signal sink so we can prove exactly which PIDs are hit
    // without sending any real signal.
    sentSignals = [];
    vi.spyOn((svc as any).dev, 'sendSignal').mockImplementation(
      ((pid: number) => { sentSignals.push(pid); }) as any,
    );
  });

  it('stopPreview(B) signals ONLY B\'s group — project A is never touched', async () => {
    await svc.stopPreview('org', 'user', 'projB', 'main');

    // B's group was reaped (group SIGTERM uses the negative pgid).
    expect(sentSignals).toContain(-B_PID);
    // The whole point: project A's PID receives zero signals (neither a bare
    // PID nor a group kill). The old OS port scan could match it; identity
    // scoping cannot.
    expect(sentSignals).not.toContain(A_PID);
    expect(sentSignals).not.toContain(-A_PID);
    // Redis state was cleaned up.
    expect(redis.unregisterPreview).toHaveBeenCalled();
  });
});

describe('PreviewService.reconcileOwnedPreviews', () => {
  const R_PID = 999_000_003;
  const R_PORT = 30005;

  it('reaps this pod\'s prior previews by pgid, releases port claims, unregisters', async () => {
    const portManager = { release: vi.fn(), allocate: vi.fn(), dispose: vi.fn() };
    const redis = {
      listPreviewsByPod: vi.fn(async () => [previewState({
        port: R_PORT,
        packages: [{ name: 'app', type: 'frontend', port: R_PORT, pid: R_PID, pgid: R_PID, podId: HOST }],
      })]),
      unregisterPreview: vi.fn(async () => undefined),
      getPreview: vi.fn(async () => null),
    };
    const svc = new PreviewService(portManager as any, redis as any, undefined, makeStateStoreStub());
    const sent: number[] = [];
    vi.spyOn((svc as any).dev, 'sendSignal').mockImplementation(((pid: number) => { sent.push(pid); }) as any);

    await svc.reconcileOwnedPreviews();

    expect(redis.listPreviewsByPod).toHaveBeenCalledWith(HOST);
    // Group-reaped by persisted pgid.
    expect(sent).toContain(-R_PID);
    // Port claim released + state unregistered.
    expect(portManager.release).toHaveBeenCalledWith(R_PORT);
    expect(redis.unregisterPreview).toHaveBeenCalledWith('org', 'user', 'projB', 'main');
  });

  it('is a no-op when this pod owns no previews', async () => {
    const redis = { listPreviewsByPod: vi.fn(async () => []), unregisterPreview: vi.fn() };
    const svc = new PreviewService(undefined, redis as any, undefined, makeStateStoreStub());
    await expect(svc.reconcileOwnedPreviews()).resolves.toBeUndefined();
    expect(redis.unregisterPreview).not.toHaveBeenCalled();
  });
});
