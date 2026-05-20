/**
 * Phase 6 — `ProjectService.deleteProject` cascade with stage-specific
 * failure handling.
 *
 * Locks:
 *   - Each step failure throws `ProjectDeletionError({ stage, canForceCleanup: true })`
 *     in strict mode (`force=false`).
 *   - `force=true` swallows steps 1-4 failures (warn) and continues.
 *   - Step 5 (fsVerify) hard-fails even in force mode — the disk verify is
 *     the final correctness gate.
 *   - `Project not found` is surfaced raw (route maps to 404).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, promises as fsPromises } from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { ProjectService } from '../../src/periphery/adapters/http/services/ProjectService';
import {
  ProjectDeletionError,
  DeletionVerificationError,
} from '../../src/periphery/adapters/http/services/ProjectService/errors';
import type { WorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';
import type { UserContext } from '../../src/core/types/user';
import type { IDEOrchestratorPort } from '../../src/core/ports/ideOrchestrator';
import type { StateStorePort } from '../../src/core/ports/stateStore';
import type { JobQueuePort } from '../../src/core/ports/queue';

interface Fixture {
  base: string;
  resolver: WorkspaceResolver;
  userContext: UserContext;
  stateStore: StateStorePort;
  jobQueue: JobQueuePort;
  ideOrch: IDEOrchestratorPort;
}

function makeFixture(overrides?: {
  ideCleanupShouldThrow?: Error;
  stateStoreCleanupShouldThrow?: Error;
  cancelJobsShouldThrow?: Error;
  previewAckShouldThrow?: Error;
}): Fixture {
  const base = mkdtempSync(path.join(os.tmpdir(), 'ant-cascade-'));
  const userContext: UserContext = { userId: 'user', organizationId: 'org', email: 'u@example.com' } as any;
  const resolver: WorkspaceResolver = {
    getWorkspacePath: () => path.join(base, 'org', 'user'),
    getProjectPath: (_ctx: UserContext, projectId: string) => path.join(base, 'org', 'user', projectId),
    getFeaturePath: (_ctx: UserContext, projectId: string, featureId: string) =>
      path.join(base, 'org', 'user', projectId, 'features', featureId),
    getCodebasePath: (_ctx: UserContext, projectId: string, featureId?: string) =>
      featureId
        ? path.join(base, 'org', 'user', projectId, 'features', featureId, 'codebase')
        : path.join(base, 'org', 'user', projectId, 'codebase'),
    getPhysicalWorkspacesPath: () => base,
  };
  mkdirSync(path.join(base, 'org', 'user'), { recursive: true });

  // Preview cleanup uses publish→subscribe ack. Capture subscribers so the
  // fake stateStore can immediately deliver a matching ack when a cleanup
  // request is published — without this the real 15s ack timeout fires.
  const subscribers = new Map<string, Array<(raw: unknown) => void>>();
  const stateStore = {
    listJobsByFeature: vi.fn(async () => {
      if (overrides?.cancelJobsShouldThrow) throw overrides.cancelJobsShouldThrow;
      return [];
    }),
    cleanupProject: vi.fn(async () => {
      if (overrides?.stateStoreCleanupShouldThrow) throw overrides.stateStoreCleanupShouldThrow;
    }),
    subscribe: vi.fn(async (channel: string, cb: (raw: unknown) => void) => {
      const list = subscribers.get(channel) ?? [];
      list.push(cb);
      subscribers.set(channel, list);
      return () => {
        const remaining = (subscribers.get(channel) ?? []).filter((x) => x !== cb);
        subscribers.set(channel, remaining);
      };
    }),
    publish: vi.fn(async (channel: string, payload: any) => {
      if (overrides?.previewAckShouldThrow && channel.includes('cleanup:request')) {
        throw overrides.previewAckShouldThrow;
      }
      // Mirror the real flow: when ant-cli publishes a cleanup request, the
      // (mocked) preview process responds with a matching ack on the
      // CLEANUP_ACK channel. Deliver it synchronously to skip the 15s timeout.
      if (channel.includes('cleanup:request') && payload?.requestId) {
        const ackChannel = channel.replace('cleanup:request', 'cleanup:ack');
        const ackCbs = subscribers.get(ackChannel) ?? [];
        for (const cb of ackCbs) {
          cb({ requestId: payload.requestId, success: true });
        }
      }
    }),
  } as unknown as StateStorePort;

  const jobQueue: JobQueuePort = { cancel: vi.fn(async () => undefined) } as any;

  const ideOrch: IDEOrchestratorPort = {
    cleanupProject: vi.fn(async () => {
      if (overrides?.ideCleanupShouldThrow) throw overrides.ideCleanupShouldThrow;
    }),
    stop: vi.fn(async () => ({ success: true })),
  } as any;

  return { base, resolver, userContext, stateStore, jobQueue, ideOrch };
}

describe('ProjectService.deleteProject cascade', () => {
  let fx: Fixture;

  afterEach(() => {
    if (fx) rmSync(fx.base, { recursive: true, force: true });
  });

  it('happy path: deletes disk dir + returns cleanly (no force)', async () => {
    fx = makeFixture();
    const svc = new ProjectService(fx.resolver, undefined, undefined, fx.ideOrch, fx.stateStore, fx.jobQueue);
    const projectPath = fx.resolver.getProjectPath(fx.userContext, 'proj-happy');
    mkdirSync(projectPath, { recursive: true });
    writeFileSync(path.join(projectPath, 'config.json'), '{}', 'utf-8');

    await svc.deleteProject('proj-happy', fx.userContext);

    await expect(fs.access(projectPath)).rejects.toThrow();
  });

  it('ideCleanup failure (strict): throws ProjectDeletionError({stage:"ideCleanup", canForceCleanup:true})', async () => {
    fx = makeFixture({ ideCleanupShouldThrow: new Error('pod hung') });
    const svc = new ProjectService(fx.resolver, undefined, undefined, fx.ideOrch, fx.stateStore, fx.jobQueue);
    mkdirSync(fx.resolver.getProjectPath(fx.userContext, 'p'), { recursive: true });

    try {
      await svc.deleteProject('p', fx.userContext);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProjectDeletionError);
      const pde = err as ProjectDeletionError;
      expect(pde.stage).toBe('ideCleanup');
      expect(pde.canForceCleanup).toBe(true);
      expect(pde.cause.message).toBe('pod hung');
    }
  });

  it('force=true tolerates ideCleanup failure and continues to fsVerify', async () => {
    fx = makeFixture({ ideCleanupShouldThrow: new Error('pod hung') });
    const svc = new ProjectService(fx.resolver, undefined, undefined, fx.ideOrch, fx.stateStore, fx.jobQueue);
    const projectPath = fx.resolver.getProjectPath(fx.userContext, 'p-force');
    mkdirSync(projectPath, { recursive: true });

    await svc.deleteProject('p-force', fx.userContext, { force: true });

    await expect(fs.access(projectPath)).rejects.toThrow();
  });

  it('redisCleanup failure (strict): throws stage="redisCleanup"', async () => {
    fx = makeFixture({ stateStoreCleanupShouldThrow: new Error('redis down') });
    const svc = new ProjectService(fx.resolver, undefined, undefined, fx.ideOrch, fx.stateStore, fx.jobQueue);
    mkdirSync(fx.resolver.getProjectPath(fx.userContext, 'p'), { recursive: true });

    try {
      await svc.deleteProject('p', fx.userContext);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProjectDeletionError);
      expect((err as ProjectDeletionError).stage).toBe('redisCleanup');
    }
  });

  it('fsVerify failure: throws stage="fsVerify" with leftovers passed through', async () => {
    fx = makeFixture();
    const svc = new ProjectService(fx.resolver, undefined, undefined, fx.ideOrch, fx.stateStore, fx.jobQueue);
    const projectPath = fx.resolver.getProjectPath(fx.userContext, 'p-stuck');
    mkdirSync(projectPath, { recursive: true });
    writeFileSync(path.join(projectPath, '.nfs0001'), '', 'utf-8');

    // Force the post-rm verification loop to see the path persist by no-op'ing rm.
    const rmSpy = vi.spyOn(fsPromises, 'rm').mockImplementation(async () => undefined);

    try {
      await svc.deleteProject('p-stuck', fx.userContext);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProjectDeletionError);
      const pde = err as ProjectDeletionError;
      expect(pde.stage).toBe('fsVerify');
      expect(pde.canForceCleanup).toBe(true); // strict mode → force still offered
      expect(pde.leftovers).toContain('.nfs0001');
      expect(pde.cause).toBeInstanceOf(DeletionVerificationError);
    } finally {
      rmSpy.mockRestore();
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it('fsVerify failure with force=true: still throws, canForceCleanup=false (already tried)', async () => {
    fx = makeFixture();
    const svc = new ProjectService(fx.resolver, undefined, undefined, fx.ideOrch, fx.stateStore, fx.jobQueue);
    const projectPath = fx.resolver.getProjectPath(fx.userContext, 'p-stuck-2');
    mkdirSync(projectPath, { recursive: true });

    const rmSpy = vi.spyOn(fsPromises, 'rm').mockImplementation(async () => undefined);

    try {
      await svc.deleteProject('p-stuck-2', fx.userContext, { force: true });
      expect.fail('should have thrown even in force mode');
    } catch (err) {
      expect(err).toBeInstanceOf(ProjectDeletionError);
      const pde = err as ProjectDeletionError;
      expect(pde.stage).toBe('fsVerify');
      expect(pde.canForceCleanup).toBe(false);
    } finally {
      rmSpy.mockRestore();
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it('Project not found surfaces raw (not wrapped) — route maps to 404', async () => {
    fx = makeFixture();
    const svc = new ProjectService(fx.resolver, undefined, undefined, fx.ideOrch, fx.stateStore, fx.jobQueue);

    try {
      await svc.deleteProject('p-missing', fx.userContext);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).not.toBeInstanceOf(ProjectDeletionError);
      expect((err as Error).message).toBe('Project not found');
    }
  });
});
