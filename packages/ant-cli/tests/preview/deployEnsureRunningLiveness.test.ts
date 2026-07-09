/**
 * Regression (root fix): DeployService.ensureRunning must NOT return a cross-pod
 * `running` state whose target is dead. After a pod roll the previous owner's
 * host:port is unreachable; returning it verbatim made every serving path
 * (subdomain / path HTTP + WS upgrade) hang on the dead target, then 502.
 *
 * ensureRunning now liveness-probes a cross-pod running state and falls through
 * to rehydrate-on-this-pod when the target is unreachable.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as net from 'net';
import { DeployService } from '../../src/infrastructure/deploy/DeployService';

const COORDS = { tenantId: 'org', userId: 'user', projectId: 'proj', feature: 'feat' };

function makeService(getDeploy: any, extra: Partial<any> = {}) {
  const stateStore: any = {
    getDeploy: vi.fn(getDeploy),
    acquireLock: vi.fn(async () => true),
    releaseLock: vi.fn(async () => {}),
    ...extra,
  };
  const svc = new DeployService({
    portManager: {} as any,
    stateStore,
    workspacesPath: '/tmp/ant-test-workspaces',
  });
  return { svc, stateStore };
}

const crossPodRunning = (host: string, port: number) => ({
  ...COORDS,
  phase: 'running',
  podId: 'previous-pod-xyz', // != os.hostname()
  host,
  packages: [{ slug: 'web', port, kind: 'static', urlKey: 'org--user--proj--feat', phase: 'running' }],
});

describe('DeployService.ensureRunning cross-pod liveness', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the cross-pod running state as-is when the target IS reachable', async () => {
    const server = net.createServer();
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as net.AddressInfo).port;

    const state = crossPodRunning('127.0.0.1', port);
    const { svc } = makeService(async () => state);
    const metaRead = vi.spyOn((svc as any).metaStore, 'read');

    const result = await svc.ensureRunning(COORDS.tenantId, COORDS.userId, COORDS.projectId, COORDS.feature);

    expect(result).toBe(state);
    expect(metaRead).not.toHaveBeenCalled(); // no rehydrate
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('falls through to rehydrate (does NOT return the stale state) when the target is unreachable', async () => {
    const state = crossPodRunning('10.0.0.9', 54321);
    const { svc } = makeService(async () => state);
    vi.spyOn(svc as any, 'broadcastStatus').mockResolvedValue(undefined);
    // No meta → rehydrate returns null fast (no spawn). Proves we fell through.
    const metaRead = vi.spyOn((svc as any).metaStore, 'read').mockResolvedValue(null as any);

    const result = await svc.ensureRunning(COORDS.tenantId, COORDS.userId, COORDS.projectId, COORDS.feature);

    expect(result).not.toBe(state);   // stale state was rejected
    expect(result).toBeNull();
    expect(metaRead).toHaveBeenCalled(); // rehydrate was attempted on this pod
  });
});
