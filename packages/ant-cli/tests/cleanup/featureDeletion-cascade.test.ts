/**
 * Phase 7 — `ProjectService.deleteFeature` cascade with stage-specific
 * failure handling.
 *
 * Sibling of `projectDeletion-cascade.test.ts`. Locks:
 *   - Strict mode: each step failure throws
 *     `FeatureDeletionError({ stage, canForceCleanup: true })`.
 *   - `force=true` swallows steps 1-4 failures (warn) and continues.
 *   - Step 5 (fsVerify) hard-fails even in force mode.
 *   - `Feature not found` surfaces raw (route maps to 404).
 *   - Active job (running/queued/pending) refused with cancelJobs stage
 *     when force=false.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, promises as fsPromises } from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { ProjectService } from '../../src/periphery/adapters/http/services/ProjectService';
import { FeatureDeletionError } from '../../src/periphery/adapters/http/services/ProjectService/errors';
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
  ideStopShouldFail?: { message: string };
  jobs?: Array<{ jobId: string; status: string }>;
  cleanupFeatureShouldThrow?: Error;
}): Fixture {
  const base = mkdtempSync(path.join(os.tmpdir(), 'ant-feature-cascade-'));
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

  const subscribers = new Map<string, Array<(raw: unknown) => void>>();
  const stateStore = {
    listJobsByFeature: vi.fn(async () => overrides?.jobs ?? []),
    markUserStopped: vi.fn(async () => undefined),
    setKillReason: vi.fn(async () => undefined),
    getJobStatus: vi.fn(async () => null),
    cleanupFeature: vi.fn(async () => {
      if (overrides?.cleanupFeatureShouldThrow) throw overrides.cleanupFeatureShouldThrow;
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
      if (channel.includes('cleanup:request') && payload?.requestId) {
        const ackChannel = channel.replace('cleanup:request', 'cleanup:ack');
        const ackCbs = subscribers.get(ackChannel) ?? [];
        for (const cb of ackCbs) cb({ requestId: payload.requestId, success: true });
      }
    }),
  } as unknown as StateStorePort;

  const jobQueue: JobQueuePort = { cancel: vi.fn(async () => undefined) } as any;

  const ideOrch: IDEOrchestratorPort = {
    cleanupProject: vi.fn(async () => undefined),
    stop: vi.fn(async () => {
      if (overrides?.ideStopShouldFail) {
        return { success: false, message: overrides.ideStopShouldFail.message };
      }
      return { success: true };
    }),
  } as any;

  return { base, resolver, userContext, stateStore, jobQueue, ideOrch };
}

async function makeFeatureDir(fx: Fixture, projectId: string, featureName: string) {
  const featurePath = fx.resolver.getFeaturePath(fx.userContext, projectId, featureName);
  mkdirSync(featurePath, { recursive: true });
  writeFileSync(path.join(featurePath, 'placeholder.txt'), 'x', 'utf-8');
  return featurePath;
}

describe('ProjectService.deleteFeature cascade', () => {
  let fx: Fixture;

  afterEach(() => {
    if (fx) rmSync(fx.base, { recursive: true, force: true });
  });

  it('happy path: removes the feature directory + no errors', async () => {
    fx = makeFixture();
    const svc = new ProjectService(fx.resolver, undefined, undefined, fx.ideOrch, fx.stateStore, fx.jobQueue);
    const featurePath = await makeFeatureDir(fx, 'p1', 'f1');

    await svc.deleteFeature('p1', 'f1', fx.userContext);

    await expect(fs.access(featurePath)).rejects.toThrow();
  });

  it('refuses delete when an active job is running (cancelJobs stage)', async () => {
    fx = makeFixture({ jobs: [{ jobId: 'live-job', status: 'running' }] });
    const svc = new ProjectService(fx.resolver, undefined, undefined, fx.ideOrch, fx.stateStore, fx.jobQueue);
    await makeFeatureDir(fx, 'p1', 'f1');

    await expect(svc.deleteFeature('p1', 'f1', fx.userContext)).rejects.toMatchObject({
      name: 'FeatureDeletionError',
      stage: 'cancelJobs',
      canForceCleanup: true,
    });
  });

  it('force=true cancels even active jobs and continues through cascade', async () => {
    fx = makeFixture({ jobs: [{ jobId: 'live-job', status: 'running' }] });
    const svc = new ProjectService(fx.resolver, undefined, undefined, fx.ideOrch, fx.stateStore, fx.jobQueue);
    const featurePath = await makeFeatureDir(fx, 'p1', 'f1');

    await svc.deleteFeature('p1', 'f1', fx.userContext, { force: true });

    expect(fx.jobQueue.cancel).toHaveBeenCalledWith('live-job');
    await expect(fs.access(featurePath)).rejects.toThrow();
  });

  it('ideCleanup failure (strict): throws FeatureDeletionError({stage:"ideCleanup", canForceCleanup:true})', async () => {
    fx = makeFixture({ ideStopShouldFail: { message: 'pod stuck' } });
    const svc = new ProjectService(fx.resolver, undefined, undefined, fx.ideOrch, fx.stateStore, fx.jobQueue);
    await makeFeatureDir(fx, 'p1', 'f1');

    await expect(svc.deleteFeature('p1', 'f1', fx.userContext)).rejects.toMatchObject({
      name: 'FeatureDeletionError',
      stage: 'ideCleanup',
      canForceCleanup: true,
    });
  });

  it('ideCleanup failure (force=true): warn-tolerated, cascade continues to fsVerify', async () => {
    fx = makeFixture({ ideStopShouldFail: { message: 'pod stuck' } });
    const svc = new ProjectService(fx.resolver, undefined, undefined, fx.ideOrch, fx.stateStore, fx.jobQueue);
    const featurePath = await makeFeatureDir(fx, 'p1', 'f1');

    await svc.deleteFeature('p1', 'f1', fx.userContext, { force: true });

    await expect(fs.access(featurePath)).rejects.toThrow();
  });

  it('redisCleanup failure (strict): wraps into FeatureDeletionError({stage:"redisCleanup"})', async () => {
    fx = makeFixture({ cleanupFeatureShouldThrow: new Error('redis blip') });
    const svc = new ProjectService(fx.resolver, undefined, undefined, fx.ideOrch, fx.stateStore, fx.jobQueue);
    await makeFeatureDir(fx, 'p1', 'f1');

    await expect(svc.deleteFeature('p1', 'f1', fx.userContext)).rejects.toMatchObject({
      name: 'FeatureDeletionError',
      stage: 'redisCleanup',
      canForceCleanup: true,
    });
  });

  it('Feature not found: surfaces raw (route maps to 404)', async () => {
    fx = makeFixture();
    const svc = new ProjectService(fx.resolver, undefined, undefined, fx.ideOrch, fx.stateStore, fx.jobQueue);

    await expect(svc.deleteFeature('p1', 'missing-feature', fx.userContext)).rejects.toThrow('Feature not found');
  });
});
