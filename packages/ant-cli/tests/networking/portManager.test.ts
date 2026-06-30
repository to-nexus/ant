import { describe, it, expect, vi } from 'vitest';
import { PortManager, PORT_RANGES } from '../../src/infrastructure/networking/PortManager';
import { REDIS_KEYS } from '../../src/core/constants/redis';

/**
 * PortManager is now Redis-authoritative: a port number is claimed via an
 * atomic `SET key NX EX ttl`, so it is GLOBALLY UNIQUE across every pod. The
 * old pod-local in-memory `usedPorts` set let two pods hand out the same
 * number (project A on pod-1 and project B on pod-2 both got 30000) — the
 * root of cross-project preview kills. These tests pin the new contract.
 */

/** Minimal in-memory fake of the StateStore primitives PortManager uses. */
function makeFakeStore() {
  const keys = new Map<string, string>();
  const counters = new Map<string, number>();
  const store = {
    tryAcquireLock: vi.fn(async (key: string, value: string, _ttl: number) => {
      if (keys.has(key)) return false; // NX semantics
      keys.set(key, value);
      return true;
    }),
    deleteKey: vi.fn(async (key: string) => { keys.delete(key); }),
    incrementKey: vi.fn(async (key: string) => {
      const n = (counters.get(key) ?? 0) + 1;
      counters.set(key, n);
      return n;
    }),
    expireKey: vi.fn(async () => { /* no-op */ }),
  };
  return { store, keys, counters };
}

describe('PortManager — Redis-authoritative allocation', () => {
  it('two PortManager instances against one Redis never return the same dev-server port', async () => {
    const { store } = makeFakeStore();
    const pmA = new PortManager(store as any);
    const pmB = new PortManager(store as any);

    const ports: number[] = [];
    for (let i = 0; i < 5; i++) {
      ports.push(await pmA.allocate('dev-server', { serverKey: 'A' }));
      ports.push(await pmB.allocate('dev-server', { serverKey: 'B' }));
    }

    // All globally unique (the collision that caused the bug is impossible).
    expect(new Set(ports).size).toBe(ports.length);
    // All within the dev-server range.
    for (const p of ports) {
      expect(p).toBeGreaterThanOrEqual(PORT_RANGES['dev-server'].min);
      expect(p).toBeLessThanOrEqual(PORT_RANGES['dev-server'].max);
    }

    pmA.dispose();
    pmB.dispose();
  });

  it('a released port frees its Redis claim (becomes reclaimable)', async () => {
    const { store, keys } = makeFakeStore();
    const pm = new PortManager(store as any);

    const port = await pm.allocate('dev-server');
    const claimKey = REDIS_KEYS.INFRA.PORT_CLAIM('dev-server', port);
    expect(keys.has(claimKey)).toBe(true);

    pm.release(port);
    expect(keys.has(claimKey)).toBe(false);
    // A fresh NX claim on the same key now succeeds.
    expect(await store.tryAcquireLock(claimKey, 'x', 1)).toBe(true);

    pm.dispose();
  });

  it('release derives the type from the port range (deploy → deploy claim key)', async () => {
    const { store } = makeFakeStore();
    const pm = new PortManager(store as any);

    const port = await pm.allocate('deploy');
    pm.release(port);

    expect(store.deleteKey).toHaveBeenCalledWith(REDIS_KEYS.INFRA.PORT_CLAIM('deploy', port));
    pm.dispose();
  });

  it('throws on range exhaustion (every claim contended)', async () => {
    const { store } = makeFakeStore();
    // Simulate a fully-claimed range: NX always fails.
    store.tryAcquireLock.mockResolvedValue(false);
    const pm = new PortManager(store as any);

    await expect(pm.allocate('deploy')).rejects.toThrow(/No available ports in deploy/);
    pm.dispose();
  });

  it('throws loudly when no Redis-backed store is injected (no in-memory fallback)', async () => {
    const pm = new PortManager(); // no stateStore
    await expect(pm.allocate('dev-server')).rejects.toThrow(/Redis-backed StateStore is required/);
  });
});
