import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import simpleGit from 'simple-git';
import { UnifiedWorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';
import type { UserContext } from '../../src/core/types/user';
import { ProjectCrudService } from '../../src/periphery/adapters/http/services/ProjectService/ProjectCrudService';
import { FeatureCrudService } from '../../src/periphery/adapters/http/services/ProjectService/FeatureCrudService';
import { WorktreeService } from '../../src/periphery/adapters/http/services/GitService/worktree';

const userContext: UserContext = {
  organizationId: 'org-test',
  userId: 'user-test',
};

const tmpRoots: string[] = [];

async function mkWorkspace(): Promise<{ workspaceRoot: string; resolver: UnifiedWorkspaceResolver }> {
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ant-workspace-'));
  tmpRoots.push(workspaceRoot);
  return {
    workspaceRoot,
    resolver: new UnifiedWorkspaceResolver(workspaceRoot),
  };
}

async function hasCommit(codebasePath: string): Promise<boolean> {
  const git = simpleGit(codebasePath);
  const log = await git.log({ maxCount: 1 });
  return Boolean(log.latest);
}

describe('project/feature git bootstrap invariant', () => {
  afterEach(async () => {
    while (tmpRoots.length > 0) {
      const root = tmpRoots.pop()!;
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it('createProject 성공 시 main codebase git + initial commit을 보장한다', async () => {
    const { resolver } = await mkWorkspace();
    const projectCrud = new ProjectCrudService(resolver);
    const projectId = 'proj-bootstrap-main';

    await projectCrud.createProject(projectId, userContext);

    const codebasePath = resolver.getCodebasePath(userContext, projectId);
    expect(fs.existsSync(path.join(codebasePath, '.git'))).toBe(true);
    expect(fs.existsSync(path.join(codebasePath, '.gitignore'))).toBe(true);
    expect(await hasCommit(codebasePath)).toBe(true);
  });

  it('main git이 비어 있어도 createFeature가 bootstrap 후 worktree를 만든다', async () => {
    const { resolver } = await mkWorkspace();
    const projectId = 'proj-feature-heal';
    const projectPath = resolver.getProjectPath(userContext, projectId);

    await fs.promises.mkdir(projectPath, { recursive: true });
    await fs.promises.writeFile(
      path.join(projectPath, 'config.json'),
      JSON.stringify({ repoType: 'cloud', repositoryName: projectId, branchBase: 'main' }, null, 2),
      'utf-8'
    );

    const featureCrud = new FeatureCrudService(resolver);
    featureCrud.setWorktreeService(new WorktreeService(resolver));

    await featureCrud.createFeature(projectId, 'feat-1', userContext);

    const mainCodebasePath = resolver.getCodebasePath(userContext, projectId);
    const featureCodebasePath = resolver.getCodebasePath(userContext, projectId, 'feat-1');
    expect(fs.existsSync(path.join(mainCodebasePath, '.git'))).toBe(true);
    expect(await hasCommit(mainCodebasePath)).toBe(true);
    expect(fs.existsSync(path.join(featureCodebasePath, '.git'))).toBe(true);
  });
});
