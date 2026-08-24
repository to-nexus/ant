/**
 * Regression — local IDE idle reaping reads the REGISTRY's `lastAccessedAt`.
 *
 * `IDEService.checkIdleContainers` used to judge idle from the in-memory
 * `instances[key].lastAccessedAt`, which only moves on `startIDE` /
 * `getIDEStatus`. Nothing polls those: the IDE proxy refreshes the registry
 * (`portRegistry.touchIDE`, ideProxy.ts) and the FE probes the proxy URL, so
 * the in-memory stamp stayed frozen at container-start and every local IDE was
 * killed ~10 min after start while in active use. The K8s reaper
 * (`KubernetesIDEOrchestrator.checkIdleInstances`) always read the registry —
 * this locks the local path to the same SSOT.
 *
 * Table: registry state × expected reap decision.
 */

import { describe, it, expect, vi } from 'vitest';
import { IDEService } from '../../src/periphery/adapters/ide/IDEService';
import type { PortRegistryPort } from '../../src/core/ports/portRegistry';
import type { PortManager } from '../../src/infrastructure/networking/PortManager';

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const KEY = 'local:local:polyhedron:feature/base';

/** Seed one running instance whose IN-MEMORY stamp is well past the timeout. */
function makeService(registryMapping: unknown | null, opts?: { throws?: boolean }) {
  const getIDE = vi.fn(async () => {
    if (opts?.throws) throw new Error('redis down');
    return registryMapping as any;
  });
  const portRegistry = { getIDE } as unknown as PortRegistryPort;
  const portManager = {} as unknown as PortManager;

  const service = new IDEService(portManager, portRegistry);
  (service as any).instances.set(KEY, {
    containerId: 'c1',
    port: 40010,
    url: `/ide/${KEY}`,
    workspacePath: '/polyhedron',
    tenantId: 'local:local',
    projectId: 'polyhedron',
    status: 'running',
    createdAt: new Date(Date.now() - IDLE_TIMEOUT_MS - 60_000),
    lastAccessedAt: new Date(Date.now() - IDLE_TIMEOUT_MS - 60_000),
  });

  const stopIDE = vi.spyOn(service as any, 'stopIDE').mockResolvedValue(undefined);
  return { service, stopIDE, getIDE };
}

describe('IDEService idle reaping — registry lastAccessedAt is the single owner', () => {
  it('registry fresh + in-memory stale → NOT reaped (the regression)', async () => {
    const { service, stopIDE, getIDE } = makeService({
      port: 40010,
      lastAccessedAt: new Date(Date.now() - 5_000),
    });

    await (service as any).checkIdleContainers();

    expect(getIDE).toHaveBeenCalledWith('local', 'local', 'polyhedron', 'feature/base');
    expect(stopIDE).not.toHaveBeenCalled();
  });

  it('registry stale → reaped', async () => {
    const { service, stopIDE } = makeService({
      port: 40010,
      lastAccessedAt: new Date(Date.now() - IDLE_TIMEOUT_MS - 30_000),
    });

    await (service as any).checkIdleContainers();

    expect(stopIDE).toHaveBeenCalledWith('local:local', 'polyhedron', 'feature/base');
  });

  it('registry entry absent (TTL expired / orphan container) → in-memory stamp decides, still reaped', async () => {
    const { service, stopIDE } = makeService(null);

    await (service as any).checkIdleContainers();

    expect(stopIDE).toHaveBeenCalledWith('local:local', 'polyhedron', 'feature/base');
  });

  it('registry read throws → falls back to the in-memory stamp instead of skipping the sweep', async () => {
    const { service, stopIDE } = makeService(null, { throws: true });

    await (service as any).checkIdleContainers();

    expect(stopIDE).toHaveBeenCalledWith('local:local', 'polyhedron', 'feature/base');
  });
});
