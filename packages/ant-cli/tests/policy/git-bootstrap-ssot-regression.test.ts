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

  it('ProjectCrudService.initializeLocalGit 파편 구현이 제거되어 있다', () => {
    const content = read('src/periphery/adapters/http/services/ProjectService/ProjectCrudService.ts');
    expect(content).not.toContain('initializeLocalGit(');
    expect(content).toContain('ensureLocalGitReadyOrThrow');
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
      expect(content).toContain('GitBootstrapSSOT');
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

  it('WorktreeService 가 mainCodebasePath === worktreePath path-collision 가드를 가진다', () => {
    const content = read('src/periphery/adapters/http/services/GitService/worktree/index.ts');
    expect(content).toMatch(/mainCodebasePath\s*===\s*worktreePath/);
  });
});
