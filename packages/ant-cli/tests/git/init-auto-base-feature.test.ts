/**
 * Publish(init) on a featureless project — real git integration.
 *
 * A project without features has no codebase and no branch to push, so init
 * materializes a feature named after `branchBase` before creating the GitHub
 * repo (mirror of Clone's auto-create from the remote HEAD).
 *
 * The ordering is the regression-sensitive part: the "remote already exists →
 * use Clone instead" conflict must fire BEFORE anything is created, because a
 * feature makes Clone permanently unavailable.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { UnifiedWorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';
import { WorktreeService } from '../../src/periphery/adapters/http/services/GitService/worktree';
import { InitOperation } from '../../src/periphery/adapters/http/services/GitService/remote/operations/InitOperation';
import { RemoteChecker } from '../../src/periphery/adapters/http/services/GitService/remote/helpers/RemoteChecker';
import { gitAnchor } from '../../src/periphery/adapters/http/services/GitService/anchor/GitAnchorSSOT';
import { readBranchBase } from '../../src/core/utils/branchUtils';
import type { GitHubAuthService } from '../../src/periphery/adapters/auth/GitHubAuthService';

vi.mock('../../src/periphery/adapters/http/services/GitService/remote/helpers/RemoteChecker', () => ({
  RemoteChecker: { exists: vi.fn() },
}));

const uc = { userId: 'u', organizationId: 'o' };
const PROJECT = 'proj';

let base: string;
let resolver: UnifiedWorkspaceResolver;
let projectPath: string;
let anchorPath: string;
let remotePath: string;
let createRepo: ReturnType<typeof vi.fn>;
let init: InitOperation;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' }).trim();
}

function remoteGit(...args: string[]): string {
  return execFileSync('git', ['--git-dir', remotePath, ...args], { encoding: 'utf-8' }).trim();
}

function writeConfig(config: Record<string, unknown>): void {
  fs.writeFileSync(path.join(projectPath, 'config.json'), JSON.stringify(config), 'utf-8');
}

function listFeatures(): string[] {
  const dir = path.join(projectPath, 'features');
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-init-base-'));
  resolver = new UnifiedWorkspaceResolver(base);
  projectPath = resolver.getProjectPath(uc, PROJECT);
  anchorPath = resolver.getGitAnchorPath(uc, PROJECT);
  fs.mkdirSync(projectPath, { recursive: true });
  writeConfig({ repoType: 'cloud', githubRepo: 'https://github.com/x/y' });

  // The "GitHub repo" the stub auth service resolves to — bare so it accepts pushes.
  remotePath = path.join(base, 'remote.git');
  execFileSync('git', ['init', '--bare', remotePath]);

  createRepo = vi.fn(async () => undefined);
  const authStub = {
    createRepo,
    buildAuthenticatedUrl: async () => remotePath,
    getToken: async () => 'tok',
  } as unknown as GitHubAuthService;

  vi.mocked(RemoteChecker.exists).mockResolvedValue(false);
  init = new InitOperation(resolver, new WorktreeService(resolver, authStub), authStub);
});

afterEach(() => {
  vi.clearAllMocks();
  fs.rmSync(base, { recursive: true, force: true });
});

describe('InitOperation — featureless project', () => {
  it('materializes the base-branch feature, then publishes it', async () => {
    const result = await init.execute(PROJECT, uc);

    expect(result).toEqual({ defaultBranch: 'main', feature: 'main' });
    expect(listFeatures()).toEqual(['main']);

    const wt = resolver.getCodebasePath(uc, PROJECT, 'main');
    expect(git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(readBranchBase(projectPath)).toBe('main');

    // Connected (branchBase is now locked) and the branch reached the remote.
    expect(await gitAnchor.hasOriginRemote(anchorPath)).toBe(true);
    expect(remoteGit('rev-parse', 'refs/heads/main')).toBe(git(wt, 'rev-parse', 'HEAD'));
  });

  it('uses the configured base branch as the feature name', async () => {
    writeConfig({ repoType: 'cloud', githubRepo: 'https://github.com/x/y', branchBase: 'dev' });

    const result = await init.execute(PROJECT, uc);

    expect(result).toEqual({ defaultBranch: 'dev', feature: 'dev' });
    expect(listFeatures()).toEqual(['dev']);
    expect(remoteGit('rev-parse', 'refs/heads/dev')).toBeTruthy();
  });

  it('does not auto-create when a feature already exists', async () => {
    await new WorktreeService(resolver).createWorktree(PROJECT, 'login', uc);
    writeConfig({ repoType: 'cloud', githubRepo: 'https://github.com/x/y', branchBase: 'login' });

    const result = await init.execute(PROJECT, uc);

    expect(result).toEqual({ defaultBranch: 'login', feature: undefined });
    expect(listFeatures()).toEqual(['login']);
  });

  it('remote-exists conflict fires before any feature is created (keeps Clone available)', async () => {
    vi.mocked(RemoteChecker.exists).mockResolvedValue(true);

    await expect(init.execute(PROJECT, uc)).rejects.toThrow(/use Clone instead/i);

    expect(listFeatures()).toEqual([]);
    expect(fs.existsSync(anchorPath)).toBe(false);
    expect(createRepo).not.toHaveBeenCalled();
  });
});
