import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../..');

function read(relPath: string): string {
  const absPath = path.join(REPO_ROOT, relPath);
  return fs.readFileSync(absPath, 'utf-8');
}

describe('git bootstrap SSOT regression guard', () => {
  it('legacy not-initialized 분기가 remote operations에 재유입되지 않는다', () => {
    const operationsDir = path.join(
      REPO_ROOT,
      'src/periphery/adapters/http/services/GitService/remote/operations'
    );
    const files = fs.readdirSync(operationsDir).filter((name) => name.endsWith('Operation.ts'));

    for (const file of files) {
      const content = fs.readFileSync(path.join(operationsDir, file), 'utf-8');
      expect(content).not.toContain('Repository not initialized. Please clone or initialize first.');
    }
  });

  it('worktree fallback 로그 문자열이 제거되어 있다', () => {
    const content = read('src/periphery/adapters/http/services/GitService/worktree/index.ts');
    expect(content).not.toContain('Git not initialized, creating codebase directory only');
  });

  it('GitBootstrapSSOT / BaseGitSetupOperation 이 삭제되고 gitAnchor 가 SSOT 다', () => {
    // The legacy lazy git-init SSOT (main codebase on the base branch) is gone.
    const legacyPath = path.join(
      REPO_ROOT,
      'src/periphery/adapters/http/services/GitService/remote/operations/BaseGitSetupOperation.ts'
    );
    expect(fs.existsSync(legacyPath)).toBe(false);

    // Replacement: the bare anchor SSOT (`{project}/repo.git`), created lazily
    // by the FIRST feature. Singleton export `gitAnchor`.
    const anchorContent = read(
      'src/periphery/adapters/http/services/GitService/anchor/GitAnchorSSOT.ts'
    );
    expect(anchorContent).toContain('export const gitAnchor = new GitAnchorSSOT()');
    expect(anchorContent).toContain('ensureAnchor');
    expect(anchorContent).toContain('createInitialCommitOnBranch');

    // No fragment re-implementations elsewhere in the GitService tree.
    const gitServiceDir = path.join(
      REPO_ROOT,
      'src/periphery/adapters/http/services/GitService'
    );
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const p = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
      });
    for (const file of walk(gitServiceDir)) {
      const content = fs.readFileSync(file, 'utf-8');
      expect(content, `stale GitBootstrapSSOT reference in ${file}`).not.toContain('GitBootstrapSSOT');
      expect(content, `stale FeatureCodebaseBackup reference in ${file}`).not.toContain('FeatureCodebaseBackup');
    }
  });

  it('ProjectCrudService.createProject 는 git 을 부트스트랩하지 않는다 (파편 구현 제거)', () => {
    const content = read('src/periphery/adapters/http/services/ProjectService/ProjectCrudService.ts');
    // Legacy fragment implementations must stay dead — a fresh project has NO
    // repo.git and NO codebase/; the first feature creates the bare anchor.
    expect(content).not.toContain('initializeLocalGit(');
    expect(content).not.toContain('ensureLocalGitReady');
    expect(content).not.toContain('GitBootstrapSSOT');
  });

  it('user-facing remote operations가 공통 ensureGitRepository helper를 사용한다', () => {
    const targets = [
      'PushOperation.ts',
      'PullOperation.ts',
      'SyncOperation.ts',
      'CommitOperation.ts',
      'DiscardOperation.ts',
      'FetchOperation.ts',
    ];

    for (const file of targets) {
      const content = read(`src/periphery/adapters/http/services/GitService/remote/operations/${file}`);
      expect(content).toContain('ensureGitRepository');
      expect(content).not.toContain('GitBootstrapSSOT');
    }
  });

  // -------- Phase 3.4 (repoType auto-mapping ban) --------

  it('ProjectCrudService.createProject 에 isCloudMode auto-local 분기가 부활하지 않는다', () => {
    const content = read(
      'src/periphery/adapters/http/services/ProjectService/ProjectCrudService.ts',
    );
    // The legacy branch derived `repoType` from userContext (`local:local` →
    // `repoType:'local'+localPath`), causing worktree path-collision. The
    // bare identifier MUST be absent in this file (only sanitized via comment
    // mention is allowed below).
    expect(content).not.toMatch(/\bisCloudMode\s*=/);
    expect(content).not.toMatch(/repoType:\s*isCloudMode\s*\?/);
    // Defaults must always be `repoType:'cloud'`.
    expect(content).toContain("repoType: 'cloud'");
  });

  // NOTE: FE config.ts 의 mode 자동 매핑 가드는 패키지 경계상 ant-ui 테스트
  // 슈트가 소유한다 — `packages/ant-ui/tests/git-world/repotype-default.test.ts`.
  // BE 가 FE 파일을 가로질러 읽으면 ant-cli Dockerfile builder stage 처럼
  // ant-ui 소스가 없는 환경에서 ENOENT 가 난다.

  it("WorktreeService 가 repoType:'local' short-circuit 가드를 가진다 (path-equality 가드 폐기)", () => {
    const content = read('src/periphery/adapters/http/services/GitService/worktree/index.ts');
    // NEW guard: user-mapped external codebase (`repoType:'local'`) skips all
    // anchor / worktree / branch mutations — keyed on config, not path equality.
    expect(content).toContain('isLocalRepoType');
    expect(content).toMatch(/repoType\s*===\s*'local'/);
    // OLD guard (path collision between main codebase and worktree) is gone
    // together with the main codebase itself.
    expect(content).not.toMatch(/mainCodebasePath\s*===\s*worktreePath/);
  });
});
