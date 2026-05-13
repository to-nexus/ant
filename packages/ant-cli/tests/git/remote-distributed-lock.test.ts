/**
 * Phase 5 F5 — `RemoteService` distributed lock SSOT.
 *
 * Locks the parent plan's "no in-process Map mirrors" rule:
 *   - clone / init / fetch all wrap through `withLock`
 *   - acquire failure (`tryAcquireLock` returns false) → GitConflictError
 *   - release runs (compare-and-DEL) on success and on op throw
 *   - missing stateStore → wrapper throws (Unified Distributed System Principle)
 *
 * Avoids hitting the real ops by replacing them with synchronous spies
 * via property assignment (the operation classes are private so we
 * patch through bracket access).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RemoteService } from '../../src/periphery/adapters/http/services/GitService/remote';
import type { StateStorePort } from '../../src/core/ports/stateStore';
import type { WorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';
import type { UserContext } from '../../src/core/types/user';
import { GitConflictError } from '../../src/periphery/adapters/http/services/GitService/errors';

interface LockHistory {
  acquire: Array<{ key: string; ttl: number }>;
  release: Array<{ key: string }>;
}

function makeStateStore(acquireResults: boolean[] = []): { store: StateStorePort; history: LockHistory } {
  const history: LockHistory = { acquire: [], release: [] };
  let i = 0;
  const store = {
    tryAcquireLock: async (key: string, _value: string, ttlSec: number) => {
      history.acquire.push({ key, ttl: ttlSec });
      const r = i < acquireResults.length ? acquireResults[i] : true;
      i += 1;
      return r;
    },
    releaseLockIfOwner: async (key: string) => {
      history.release.push({ key });
    },
  } as unknown as StateStorePort;
  return { store, history };
}

const userContext: UserContext = { userId: 'u', organizationId: 'o', email: 'u@example.com' } as any;

const stubResolver = {
  getWorkspacePath: () => '/tmp',
  getProjectPath: () => '/tmp',
  getFeaturePath: () => '/tmp',
  getCodebasePath: () => '/tmp',
  getPhysicalWorkspacesPath: () => '/tmp',
} as unknown as WorkspaceResolver;

function patchOp(svc: RemoteService, prop: 'cloneOp' | 'initOp' | 'fetchOp', impl: () => Promise<any>) {
  // operations are private; bypass via cast
  (svc as any)[prop] = { execute: impl };
}

describe('RemoteService distributed lock — F5', () => {
  let svc: RemoteService;
  let store: StateStorePort;
  let history: LockHistory;

  beforeEach(() => {
    const m = makeStateStore([true]);
    store = m.store;
    history = m.history;
    svc = new RemoteService(stubResolver, undefined, undefined, store);
  });

  it('clone acquires a lock and releases on success', async () => {
    patchOp(svc, 'cloneOp', async () => ({ warnings: [] }));
    const r = await svc.cloneGitHubRepo('proj', userContext);
    expect(r).toEqual({ warnings: [] });
    expect(history.acquire).toHaveLength(1);
    expect(history.acquire[0].key).toMatch(/^ant:lock:clone:o:u:proj$/);
    expect(history.acquire[0].ttl).toBe(600);
    expect(history.release).toHaveLength(1);
  });

  it('clone releases the lock when the op throws', async () => {
    patchOp(svc, 'cloneOp', async () => {
      throw new Error('boom');
    });
    await expect(svc.cloneGitHubRepo('proj', userContext)).rejects.toThrow('boom');
    expect(history.release).toHaveLength(1);
  });

  it('clone throws GitConflictError when contention is detected', async () => {
    const m = makeStateStore([false]); // first acquire returns false
    svc = new RemoteService(stubResolver, undefined, undefined, m.store);
    patchOp(svc, 'cloneOp', async () => ({ warnings: [] }));
    await expect(svc.cloneGitHubRepo('proj', userContext)).rejects.toBeInstanceOf(GitConflictError);
    expect(m.history.release).toHaveLength(0);
  });

  it('init wraps with the lock.init key (TTL 120s)', async () => {
    patchOp(svc, 'initOp', async () => ({ warnings: [] }));
    await svc.initializeGitHubRepo('proj', userContext);
    expect(history.acquire[0].key).toMatch(/^ant:lock:init:o:u:proj$/);
    expect(history.acquire[0].ttl).toBe(120);
  });

  it('fetch wraps with the lock.fetch key (TTL 180s) and includes feature in the key', async () => {
    patchOp(svc, 'fetchOp', async () => undefined);
    await svc.fetchFromGitHub('proj', userContext, 'myFeature');
    expect(history.acquire[0].key).toMatch(/^ant:lock:fetch:o:u:proj:myFeature$/);
    expect(history.acquire[0].ttl).toBe(180);
  });

  it('fetch defaults feature to "main" in the key when no feature is given', async () => {
    patchOp(svc, 'fetchOp', async () => undefined);
    await svc.fetchFromGitHub('proj', userContext);
    expect(history.acquire[0].key).toMatch(/^ant:lock:fetch:o:u:proj:main$/);
  });

  it('throws when stateStore is not injected (parent rule book — no in-memory fallback)', async () => {
    const noStoreSvc = new RemoteService(stubResolver, undefined, undefined, undefined);
    patchOp(noStoreSvc, 'cloneOp', async () => ({ warnings: [] }));
    await expect(noStoreSvc.cloneGitHubRepo('proj', userContext)).rejects.toThrow(/distributed lock unavailable/);
  });
});

describe('RemoteService — in-process Map fallback removed', () => {
  it('source has no inFlightClone/inFlightInit/inFlightFetch fields', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const file = path.resolve(
      __dirname,
      '..',
      '..',
      'src/periphery/adapters/http/services/GitService/remote/index.ts',
    );
    const src = await fs.readFile(file, 'utf-8');
    expect(src).not.toMatch(/inFlightClone\b/);
    expect(src).not.toMatch(/inFlightInit\b/);
    expect(src).not.toMatch(/inFlightFetch\b/);
  });
});
