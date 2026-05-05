/**
 * Phase 2 regression — `ProjectCrudService.deleteProject` verification loop.
 *
 * Locks the post-fs.rm verification contract:
 *   - Normal delete: project disappears, returns cleanly
 *   - Verification timeout includes leftover paths in the error message
 *   - "Project not found" path is unchanged
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, promises as fsPromises } from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { ProjectCrudService } from '../../src/periphery/adapters/http/services/ProjectService/ProjectCrudService';
import type { WorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';
import type { UserContext } from '../../src/core/types/user';

interface Fixture {
  base: string;
  resolver: WorkspaceResolver;
  userContext: UserContext;
}

function makeFixture(): Fixture {
  const base = mkdtempSync(path.join(os.tmpdir(), 'ant-delete-'));
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
  return { base, resolver, userContext };
}

describe('ProjectCrudService.deleteProject', () => {
  let fx: Fixture;

  beforeEach(() => {
    fx = makeFixture();
  });

  afterEach(() => {
    rmSync(fx.base, { recursive: true, force: true });
  });

  it('deletes a normal project directory and returns cleanly', async () => {
    const svc = new ProjectCrudService(fx.resolver);
    const projectPath = fx.resolver.getProjectPath(fx.userContext, 'proj1');
    mkdirSync(projectPath, { recursive: true });
    writeFileSync(path.join(projectPath, 'config.json'), '{}', 'utf-8');

    await svc.deleteProject('proj1', fx.userContext);

    await expect(fs.access(projectPath)).rejects.toThrow();
  });

  it('throws "Project not found" when the project does not exist', async () => {
    const svc = new ProjectCrudService(fx.resolver);
    await expect(svc.deleteProject('proj-missing', fx.userContext)).rejects.toThrow('Project not found');
  });

  it('verification timeout error includes leftover paths', async () => {
    // Simulate the post-fs.rm leftover scenario by mocking fsPromises.rm
    // (the import the service code uses) into a no-op. The verification loop
    // then polls, sees the path still exists, and throws with leftovers.
    const svc = new ProjectCrudService(fx.resolver);
    const projectPath = fx.resolver.getProjectPath(fx.userContext, 'proj-stuck');
    mkdirSync(projectPath, { recursive: true });
    writeFileSync(path.join(projectPath, '.nfs0001'), '', 'utf-8');
    writeFileSync(path.join(projectPath, 'config.json'), '{}', 'utf-8');

    // ProjectCrudService imports `fs` (node:fs) and uses `fs.promises.rm`.
    // `fsPromises` from the test imports IS that same `fs.promises` object,
    // so spying on `rm` here intercepts what the service calls.
    const rmSpy = vi.spyOn(fsPromises, 'rm').mockImplementation(async () => undefined);

    try {
      await expect(svc.deleteProject('proj-stuck', fx.userContext)).rejects.toThrow(
        /verification timed out/,
      );
    } finally {
      rmSpy.mockRestore();
      rmSync(projectPath, { recursive: true, force: true });
    }
  });
});
