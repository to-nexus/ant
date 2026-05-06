/**
 * Locks createWorktree.preExisting noise suppression:
 * `no-git-file` after FeatureCrud-style empty `codebase/` mkdir → info only (no worktreeValidityFailure warn).
 * Other invalid reasons still emit warn-level diagnostic.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import simpleGit from 'simple-git';

import { UnifiedWorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';
import type { UserContext } from '../../src/core/types/user';
import { logger } from '../../src/utils/logger';
import { ProjectCrudService } from '../../src/periphery/adapters/http/services/ProjectService/ProjectCrudService';
import { WorktreeService } from '../../src/periphery/adapters/http/services/GitService/worktree';

const userContext: UserContext = {
  organizationId: 'org-test',
  userId: 'user-test',
};

const tmpRoots: string[] = [];

async function mkWorkspace(): Promise<{ resolver: UnifiedWorkspaceResolver }> {
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ant-wt-noise-'));
  tmpRoots.push(workspaceRoot);
  return { resolver: new UnifiedWorkspaceResolver(workspaceRoot) };
}

describe('createWorktree.preExisting — no-git-file vs diagnostic warn', () => {
  afterEach(async () => {
    while (tmpRoots.length > 0) {
      const root = tmpRoots.pop()!;
      await fs.promises.rm(root, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('case A — empty codebase dir only: info, no worktreeValidityFailure warn', async () => {
    const { resolver } = await mkWorkspace();
    const projectCrud = new ProjectCrudService(resolver);
    const projectId = 'proj-preexist-a';
    await projectCrud.createProject(projectId, userContext);

    const featureName = 'feat-preexist-a';
    const featurePath = resolver.getFeaturePath(userContext, projectId, featureName);
    await fs.promises.mkdir(path.join(featurePath, 'codebase'), { recursive: true });

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

    const worktreeService = new WorktreeService(resolver);
    await worktreeService.createWorktree(projectId, featureName, userContext);

    const validityFailureWarns = warnSpy.mock.calls.filter((c) => c[0] === 'worktreeValidityFailure');
    expect(validityFailureWarns).toHaveLength(0);

    const preExistInfo = infoSpy.mock.calls.find((c) =>
      typeof c[0] === 'string' && c[0].includes('Pre-existing empty dir at worktree path'),
    );
    expect(preExistInfo).toBeDefined();

    const featureCodebase = resolver.getCodebasePath(userContext, projectId, featureName);
    expect(fs.existsSync(path.join(featureCodebase, '.git'))).toBe(true);
  });

  it('case B — invalid .git marker: worktreeValidityFailure warn once (S4)', async () => {
    const { resolver } = await mkWorkspace();
    const projectCrud = new ProjectCrudService(resolver);
    const projectId = 'proj-preexist-b';
    await projectCrud.createProject(projectId, userContext);

    const featureName = 'feat-preexist-b';
    const featurePath = resolver.getFeaturePath(userContext, projectId, featureName);
    const featureCodebase = path.join(featurePath, 'codebase');
    await fs.promises.mkdir(featureCodebase, { recursive: true });
    await fs.promises.writeFile(path.join(featureCodebase, '.git'), 'totally not a gitdir line\n', 'utf-8');

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const worktreeService = new WorktreeService(resolver);
    await worktreeService.createWorktree(projectId, featureName, userContext);

    const validityCalls = warnSpy.mock.calls.filter((c) => c[0] === 'worktreeValidityFailure');
    expect(validityCalls.length).toBeGreaterThanOrEqual(1);
    const meta = validityCalls[0][2] as { callSite?: string; reason?: string; scenario?: string };
    expect(meta.callSite).toBe('createWorktree.preExisting');
    expect(meta.reason).toBe('invalid-marker');
    expect(meta.scenario).toBe('S4-corrupt-marker');

    expect(fs.existsSync(path.join(featureCodebase, '.git'))).toBe(true);
  });

  it('case C — marker points at missing gitdir: worktreeValidityFailure warn (gitdir-missing / S3)', async () => {
    const { resolver } = await mkWorkspace();
    const projectCrud = new ProjectCrudService(resolver);
    const projectId = 'proj-preexist-c';
    await projectCrud.createProject(projectId, userContext);

    const mainCodebasePath = resolver.getCodebasePath(userContext, projectId);
    const ghostMeta = path.join(mainCodebasePath, '.git', 'worktrees', 'ghost-no-such-dir');

    const featureName = 'feat-preexist-c';
    const featurePath = resolver.getFeaturePath(userContext, projectId, featureName);
    const featureCodebase = path.join(featurePath, 'codebase');
    await fs.promises.mkdir(featureCodebase, { recursive: true });
    await fs.promises.writeFile(path.join(featureCodebase, '.git'), `gitdir: ${ghostMeta}\n`, 'utf-8');

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const worktreeService = new WorktreeService(resolver);
    await worktreeService.createWorktree(projectId, featureName, userContext);

    const validityCalls = warnSpy.mock.calls.filter((c) => c[0] === 'worktreeValidityFailure');
    expect(validityCalls.length).toBeGreaterThanOrEqual(1);
    const meta = validityCalls[0][2] as { reason?: string; scenario?: string };
    expect(meta.reason).toBe('gitdir-missing');
    expect(meta.scenario).toBe('S3-stale-marker-from-previous-attempt');

    const git = simpleGit(mainCodebasePath);
    const wtList = await git.raw(['worktree', 'list', '--porcelain']);
    expect(wtList).toContain(featureCodebase);
  });
});
