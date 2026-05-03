import { describe, it, expect, vi } from 'vitest';
import { PreviewService } from '../../src/periphery/adapters/http/services/PreviewService/PreviewService';

/**
 * Multi-package stop/exit tracking regression.
 *
 * The old `handleProcessExit` derived "which PID just exited?" from
 * `previewServers.get(serverKey)?.[0].pid`. For multi-frontend monorepos
 * (apps/hub + apps/storefront, etc.) that meant:
 *
 *   - Sibling B exits during stop. Handler reads "which PID exited?" →
 *     gets A's PID. A is still alive. The exit is misattributed and B's
 *     real PID stays in `stoppingPidsByServer`.
 *   - When A actually exits later, the handler reads A's PID (now the
 *     only live one... or worse, undefined), the set still has B's PID
 *     so size > 0, and the stoppingServers/timer cleanup is delayed past
 *     the 10s safety net.
 *
 * The fix: `handleProcessExit(serverKey, pkgName, exitedPid, code, signal)`.
 * The exit callback now receives the actual exited PID from the spawner,
 * and we delete THAT pid from the set. These tests pin the contract by
 * driving the handler directly with synthetic PIDs.
 */

function withSvc<T>(fn: (svc: PreviewService) => T): T {
  const svc = new PreviewService();
  return fn(svc);
}

describe('PreviewService.handleProcessExit — multi-package PID tracking', () => {
  it('removes only the exited PID from stoppingPidsByServer (not always-first-PID)', () => {
    withSvc(svc => {
      const key = 'org:user:proj:feature';
      // Pretend stop has been initiated for two children.
      const stoppingMap: Map<string, Set<number>> = (svc as any).stoppingPidsByServer;
      const stoppingSet = (svc as any).stoppingServers as Set<string>;
      stoppingSet.add(key);
      stoppingMap.set(key, new Set([1001, 1002]));

      // Sibling 1002 exits first.
      (svc as any).handleProcessExit(key, 'apps/storefront', 1002, 0, null);

      // Only 1002 should be removed; 1001 is still pending teardown.
      expect(stoppingMap.get(key)).toEqual(new Set([1001]));
      expect(stoppingSet.has(key)).toBe(true);

      // 1001 exits.
      (svc as any).handleProcessExit(key, 'apps/hub', 1001, 0, null);

      // Set fully drained → state cleaned up.
      expect(stoppingMap.has(key)).toBe(false);
      expect(stoppingSet.has(key)).toBe(false);
    });
  });

  it('treats exit with unknown PID (during stop) as expected and falls through to stoppingServers gate', () => {
    withSvc(svc => {
      const key = 'org:user:proj:feature';
      const stoppingMap: Map<string, Set<number>> = (svc as any).stoppingPidsByServer;
      const stoppingSet = (svc as any).stoppingServers as Set<string>;
      stoppingSet.add(key);
      stoppingMap.set(key, new Set([1001]));

      // Spawner gave us no PID (extreme edge case). The legacy handler
      // would have used `previewServers[0].pid` and possibly removed 1001
      // by accident; the new handler MUST NOT delete an arbitrary PID.
      (svc as any).handleProcessExit(key, 'apps/hub', null, 0, null);

      // Still pending — 1001 was not consumed.
      expect(stoppingMap.get(key)).toEqual(new Set([1001]));
      expect(stoppingSet.has(key)).toBe(true);
    });
  });

  it('does NOT report an unknown unexpected exit as expected', () => {
    withSvc(svc => {
      const key = 'org:user:proj:feature';
      // No stoppingServers entry, no stoppingPids — should be treated as
      // an unexpected crash and trigger appendLog + cleanupIfAllDead.
      const cleanupSpy = vi.spyOn(svc as any, 'cleanupIfAllDead').mockImplementation(() => {});
      const appendSpy = vi.spyOn(svc as any, 'appendLog').mockImplementation(() => {});

      (svc as any).handleProcessExit(key, 'apps/hub', 1001, 1, null);

      expect(cleanupSpy).toHaveBeenCalledWith(key);
      expect(appendSpy).toHaveBeenCalled();  // exited with non-zero
      cleanupSpy.mockRestore();
      appendSpy.mockRestore();
    });
  });
});
