import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import simpleGit from 'simple-git';
import type { WorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';
import type { UserContext } from '../../src/core/types/user';
import { GitBootstrapSSOT } from '../../src/periphery/adapters/http/services/GitService/remote/operations/BaseGitSetupOperation';

const userContext: UserContext = {
  organizationId: 'test-org',
  userId: 'test-user',
};

const workspaceResolver = {} as WorkspaceResolver;
const tmpRoots: string[] = [];

async function createTmpCodebase(prefix: string): Promise<{ root: string; codebasePath: string }> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
  const codebasePath = path.join(root, 'codebase');
  await fs.promises.mkdir(codebasePath, { recursive: true });
  tmpRoots.push(root);
  return { root, codebasePath };
}

async function latestCommit(codebasePath: string): Promise<string | null> {
  const git = simpleGit(codebasePath);
  const log = await git.log({ maxCount: 1 });
  return log.latest?.hash ?? null;
}

describe('GitBootstrapSSOT', () => {
  afterEach(async () => {
    while (tmpRoots.length > 0) {
      const root = tmpRoots.pop()!;
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it('fresh codebase를 git + .gitignore + initial commit 상태로 만든다', async () => {
    const { codebasePath } = await createTmpCodebase('ant-git-bootstrap-fresh-');
    const bootstrap = new GitBootstrapSSOT(workspaceResolver, 'GitBootstrapSSOTTest');

    const result = await bootstrap.ensureLocalGitReady({
      projectId: 'proj-fresh',
      codebasePath,
      baseBranch: 'main',
      userContext,
    });

    expect(result.ready).toBe(true);
    expect(result.created).toBe(true);
    expect(fs.existsSync(path.join(codebasePath, '.git'))).toBe(true);
    expect(fs.existsSync(path.join(codebasePath, '.gitignore'))).toBe(true);
    expect(await latestCommit(codebasePath)).not.toBeNull();
  });

  it('기존 non-git 디렉터리도 커밋 가능한 git 저장소로 승격한다', async () => {
    const { codebasePath } = await createTmpCodebase('ant-git-bootstrap-existing-');
    await fs.promises.mkdir(path.join(codebasePath, 'src'), { recursive: true });
    await fs.promises.writeFile(path.join(codebasePath, 'src', 'index.ts'), 'export const x = 1;\n', 'utf-8');

    const bootstrap = new GitBootstrapSSOT(workspaceResolver, 'GitBootstrapSSOTTest');
    const result = await bootstrap.ensureLocalGitReady({
      projectId: 'proj-existing',
      codebasePath,
      baseBranch: 'main',
      userContext,
    });

    const git = simpleGit(codebasePath);
    const trackedFiles = await git.raw(['ls-files']);

    expect(result.ready).toBe(true);
    expect(result.created).toBe(true);
    expect(trackedFiles).toContain('src/index.ts');
  });

  it('이미 init 되었지만 commit 없는 저장소에 initial commit을 보강한다', async () => {
    const { codebasePath } = await createTmpCodebase('ant-git-bootstrap-unborn-');
    const git = simpleGit(codebasePath);
    await git.init(['--initial-branch=main']);
    await fs.promises.writeFile(path.join(codebasePath, 'README.md'), '# tmp\n', 'utf-8');

    const bootstrap = new GitBootstrapSSOT(workspaceResolver, 'GitBootstrapSSOTTest');
    const result = await bootstrap.ensureLocalGitReady({
      projectId: 'proj-unborn',
      codebasePath,
      baseBranch: 'main',
      userContext,
    });

    expect(result.ready).toBe(true);
    expect(result.created).toBe(false);
    expect(await latestCommit(codebasePath)).not.toBeNull();
  });
});
