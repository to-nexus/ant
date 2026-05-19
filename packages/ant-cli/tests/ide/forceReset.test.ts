/**
 * Regression — `KubernetesIDEOrchestrator.forceReset` contract.
 *
 *   1. DELETE body sets `gracePeriodSeconds: 0` (vs default 5 for `stop()`).
 *   2. After pod deletion, the state-store mapping is verified gone — polls
 *      `getIDE` until it returns null.
 *   3. If the mapping persists after the verification window, throw.
 *
 * The orchestrator's pod-deletion wait is mocked to resolve immediately so
 * tests run fast.
 */

import { describe, it, expect, vi } from 'vitest';
import { KubernetesIDEOrchestrator } from '../../src/infrastructure/ide/KubernetesIDEOrchestrator';
import type { StateStorePort } from '../../src/core/ports/stateStore';

function makeStateStore(): { stateStore: StateStorePort; getIDE: ReturnType<typeof vi.fn>; unregisterIDE: ReturnType<typeof vi.fn> } {
  const getIDE = vi.fn(async () => null);
  const unregisterIDE = vi.fn(async () => undefined);
  const stateStore = { getIDE, unregisterIDE } as unknown as StateStorePort;
  return { stateStore, getIDE, unregisterIDE };
}

function makeOrch(stateStore: StateStorePort) {
  const orch = new KubernetesIDEOrchestrator({}, stateStore);
  // Skip the actual wait — pod deletion is mocked elsewhere.
  vi.spyOn(orch as any, 'waitForPodDeletion').mockResolvedValue(undefined);
  return orch;
}

describe('KubernetesIDEOrchestrator.forceReset', () => {
  it('DELETE body sets gracePeriodSeconds: 0 (vs default 5)', async () => {
    const { stateStore } = makeStateStore();
    const orch = makeOrch(stateStore);

    const k8sRequest = vi.spyOn(orch as any, 'k8sRequest').mockResolvedValue(undefined);

    const result = await orch.forceReset('org:user', 'proj', 'main');

    expect(result.success).toBe(true);
    // Find the pod DELETE call
    const deleteCall = k8sRequest.mock.calls.find(([_path, method]) => method === 'DELETE' && String(_path).includes('/pods/'));
    expect(deleteCall).toBeDefined();
    expect(deleteCall![2]).toEqual({ gracePeriodSeconds: 0 });
  });

  it('verifies state-store cleanup — polls getIDE until null', async () => {
    const { stateStore, getIDE, unregisterIDE } = makeStateStore();
    // First two calls report a stale mapping, then null.
    getIDE
      .mockResolvedValueOnce({ port: 3000, host: '10.0.0.1', podId: 'p' } as any)
      .mockResolvedValueOnce({ port: 3000, host: '10.0.0.1', podId: 'p' } as any)
      .mockResolvedValue(null);

    const orch = makeOrch(stateStore);
    vi.spyOn(orch as any, 'k8sRequest').mockResolvedValue(undefined);

    const result = await orch.forceReset('org:user', 'proj', 'main');

    expect(result.success).toBe(true);
    // unregisterIDE called at least once (after pod deletion). May be called twice
    // if the verification path also triggered the "one last attempt" branch.
    expect(unregisterIDE).toHaveBeenCalled();
    // getIDE was polled multiple times until it returned null.
    expect(getIDE.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('returns success:false with message when state-store mapping persists past the verification window', async () => {
    const { stateStore, getIDE } = makeStateStore();
    // Always return a stale mapping — verification will time out, throw,
    // and the outer try/catch surfaces it as success:false.
    getIDE.mockResolvedValue({ port: 3000, host: '10.0.0.1', podId: 'p' } as any);

    const orch = makeOrch(stateStore);
    vi.spyOn(orch as any, 'k8sRequest').mockResolvedValue(undefined);

    const result = await orch.forceReset('org:user', 'proj', 'main');

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/persisted after force-reset/i);
  }, 10_000);

  it('tolerates pod deletion wait timeout (logs warning, continues)', async () => {
    const { stateStore } = makeStateStore();
    const orch = new KubernetesIDEOrchestrator({}, stateStore);
    vi.spyOn(orch as any, 'k8sRequest').mockResolvedValue(undefined);
    vi.spyOn(orch as any, 'waitForPodDeletion').mockRejectedValue(new Error('deletion timed out'));

    const result = await orch.forceReset('org:user', 'proj', 'main');

    expect(result.success).toBe(true);
  });
});
