/**
 * Regression — `waitForPodReady` Ready-condition gate.
 *
 * Locks the contract that pods are not considered ready merely because
 * `phase === 'Running'`. The Ready condition (driven by the readinessProbe)
 * must also be `True` — guaranteeing openvscode-server is serving HTTP, not
 * just that the container PID is alive.
 */

import { describe, it, expect, vi } from 'vitest';
import { KubernetesIDEOrchestrator } from '../../src/infrastructure/ide/KubernetesIDEOrchestrator';
import type { StateStorePort } from '../../src/core/ports/stateStore';

const stubStateStore = {} as unknown as StateStorePort;

function makeOrch(): KubernetesIDEOrchestrator {
  return new KubernetesIDEOrchestrator({}, stubStateStore);
}

function podPayload(phase: string, ready: 'True' | 'False' | undefined): any {
  return {
    metadata: { name: 'p', namespace: 'ns', labels: {} },
    spec: { containers: [] },
    status: {
      phase,
      conditions: ready ? [{ type: 'Ready', status: ready }] : [],
    },
  };
}

describe('waitForPodReady — Ready-condition gate', () => {
  it('does NOT return when phase=Running but Ready=False (probe not yet passed)', async () => {
    const orch = makeOrch();

    // Stub k8sRequest to always report Running + Ready=False
    const reqSpy = vi
      .spyOn(orch as any, 'k8sRequest')
      .mockImplementation(async () => podPayload('Running', 'False'));

    // Use a tight timeout so the test fails fast if the gate is broken
    const promise = (orch as any).waitForPodReady('p', 1_500);

    await expect(promise).rejects.toThrow(/startup timeout/);
    // Should have polled multiple times (every 2s in real loop, but timeout is 1.5s
    // so we expect at least one call). The point: it did NOT early-return.
    expect(reqSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('returns when phase=Running AND Ready=True', async () => {
    const orch = makeOrch();
    vi.spyOn(orch as any, 'k8sRequest').mockResolvedValue(podPayload('Running', 'True'));

    await expect((orch as any).waitForPodReady('p', 5_000)).resolves.toBeUndefined();
  });

  it('throws on phase=Failed without waiting for Ready', async () => {
    const orch = makeOrch();
    vi.spyOn(orch as any, 'k8sRequest').mockResolvedValue({
      metadata: { name: 'p', namespace: 'ns', labels: {} },
      spec: { containers: [] },
      status: {
        phase: 'Failed',
        conditions: [],
        containerStatuses: [{ state: { terminated: { reason: 'CrashLoopBackOff' } } }],
      },
    });

    await expect((orch as any).waitForPodReady('p', 5_000)).rejects.toThrow(/Pod failed to start/);
  });
});
