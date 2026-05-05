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
});
