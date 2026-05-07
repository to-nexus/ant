/**
 * Phase 5 F2 — `ProjectService.renameProject` cascade orchestrator.
 *
 * Locks the parent plan's stopProjectRuntime SSOT pattern shared with
 * deleteProject:
 *   1. cancelAllProjectJobs(oldId)
 *   2. ideOrchestrator.cleanupProject(oldId)
 *   3. requestPreviewCleanup(oldId)
 *   4. stateStore.cleanupProject(oldId)
 *   5. projectCrud.renameProject(oldId, newId) + verification loop
 *
 * Lazy restart: NO ide start call after rename — the next IDE entry
 * lazily mounts the new id.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, promises as fsPromises } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProjectService } from '../../src/periphery/adapters/http/services/ProjectService';
import type { WorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';
import type { UserContext } from '../../src/core/types/user';
import type { StateStorePort } from '../../src/core/ports/stateStore';
import type { JobQueuePort } from '../../src/core/ports/queue';
import type { IDEOrchestratorPort } from '../../src/core/ports/ideOrchestrator';

interface Recorded {
  ideCleanup: string[];
  ideStart: number;
  redisCleanup: Array<{ projectId: string }>;
  preview: Array<{ scope: string; projectId: string; featureName?: string }>;
  jobsByFeature: number;
}

function makeFixture() {
  const base = mkdtempSync(path.join(os.tmpdir(), 'ant-rename-'));
  const userContext: UserContext = { userId: 'user', organizationId: 'org', email: 'u@example.com' } as any;
  mkdirSync(path.join(base, 'org', 'user'), { recursive: true });
  const resolver: WorkspaceResolver = {
    getWorkspacePath: () => path.join(base, 'org', 'user'),
    getProjectPath: (_ctx, projectId) => path.join(base, 'org', 'user', projectId),
    getFeaturePath: (_ctx, projectId, featureId) =>
      path.join(base, 'org', 'user', projectId, 'features', featureId),
    getCodebasePath: (_ctx, projectId, featureId?) =>
      featureId
        ? path.join(base, 'org', 'user', projectId, 'features', featureId, 'codebase')
        : path.join(base, 'org', 'user', projectId, 'codebase'),
    getPhysicalWorkspacesPath: () => base,
  };

  const recorded: Recorded = { ideCleanup: [], ideStart: 0, redisCleanup: [], preview: [], jobsByFeature: 0 };

  const ideOrchestrator: Partial<IDEOrchestratorPort> = {
    cleanupProject: async (_ctx, projectId) => {
      recorded.ideCleanup.push(projectId);
    },
    start: async () => {
      recorded.ideStart += 1;
      return { success: true } as any;
    },
  };

  const subscribers: Array<(msg: any) => void> = [];
  const stateStore: Partial<StateStorePort> = {
    listJobsByFeature: async () => {
      recorded.jobsByFeature += 1;
      return [];
    },
    cleanupProject: async (_org, _user, projectId) => {
      recorded.redisCleanup.push({ projectId });
    },
    publish: async (_channel, msg: any) => {
      // Echo an ack so requestPreviewCleanup resolves
      recorded.preview.push({ scope: msg.scope, projectId: msg.projectId, featureName: msg.featureName });
      for (const s of subscribers) {
        s({ requestId: msg.requestId, success: true });
      }
    },
    subscribe: async (_channel, cb) => {
      subscribers.push(cb as any);
      return () => undefined;
    },
  };

  const jobQueue: Partial<JobQueuePort> = {
    cancel: async () => undefined,
  };

  const service = new ProjectService(
    resolver,
    undefined,
    undefined,
    ideOrchestrator as IDEOrchestratorPort,
    stateStore as StateStorePort,
    jobQueue as JobQueuePort,
  );

  return { base, userContext, resolver, service, recorded };
}

describe('ProjectService.renameProject cascade', () => {
  let fx: ReturnType<typeof makeFixture>;

  beforeEach(() => {
    fx = makeFixture();
  });

  afterEach(() => {
    rmSync(fx.base, { recursive: true, force: true });
  });

  it('runs stopProjectRuntime against oldId then renames the directory', async () => {
    const oldPath = fx.resolver.getProjectPath(fx.userContext, 'oldid');
    const newPath = fx.resolver.getProjectPath(fx.userContext, 'newid');
    mkdirSync(oldPath, { recursive: true });
    writeFileSync(path.join(oldPath, 'config.json'), '{}', 'utf-8');

    await fx.service.renameProject('oldid', 'newid', fx.userContext);

    // Step 1 — listJobsByFeature was called against oldId via cancelAllProjectJobs
    // (we report 0 jobs but the call itself is observable through recorded.jobsByFeature).
    // listFeatures returns nothing here (no features dir created), so jobsByFeature
    // may be 0; the substantive checks are 2-4.

    // Step 2 — ide cleanup against oldId
    expect(fx.recorded.ideCleanup).toEqual(['oldid']);

    // Step 3 — preview cleanup pubsub fired against oldId
    expect(fx.recorded.preview).toContainEqual({ scope: 'project', projectId: 'oldid', featureName: undefined });

    // Step 4 — Redis state cleanup against oldId
    expect(fx.recorded.redisCleanup).toEqual([{ projectId: 'oldid' }]);

    // Step 5 — disk rename happened
    await fsPromises.access(newPath);
    await expect(fsPromises.access(oldPath)).rejects.toThrow();

    // Lazy restart: NO ide.start was called by renameProject itself
    expect(fx.recorded.ideStart).toBe(0);
  });

  it('runs the same cascade for deleteProject (SSOT shared)', async () => {
    const projPath = fx.resolver.getProjectPath(fx.userContext, 'todelete');
    mkdirSync(projPath, { recursive: true });
    writeFileSync(path.join(projPath, 'config.json'), '{}', 'utf-8');

    await fx.service.deleteProject('todelete', fx.userContext);

    expect(fx.recorded.ideCleanup).toEqual(['todelete']);
    expect(fx.recorded.preview).toContainEqual({ scope: 'project', projectId: 'todelete', featureName: undefined });
    expect(fx.recorded.redisCleanup).toEqual([{ projectId: 'todelete' }]);
    await expect(fsPromises.access(projPath)).rejects.toThrow();
  });
});
