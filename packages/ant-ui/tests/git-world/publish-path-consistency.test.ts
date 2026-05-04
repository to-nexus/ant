import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function readFromUiRoot(relativePath: string): string {
  const absolutePath = path.resolve(__dirname, '..', '..', 'src', ...relativePath.split('/'));
  return fs.readFileSync(absolutePath, 'utf-8');
}

describe('publish path consistency', () => {
  it('keeps ProjectWizardModal on runGitOperation path', () => {
    const source = readFromUiRoot('presentation/components/ProjectWizardModal/ProjectWizardModal.tsx');
    expect(source).toContain('useGitDispatch');
    expect(source).toContain('runGitOperation(projectId, { kind: \'publish\' })');
    expect(source).not.toContain('dispatchGitOpOneShot');
  });

  it('keeps primary git actions on runGitOperation path', () => {
    const statusActions = readFromUiRoot('presentation/components/GitStatusButton/hooks/useGitActions.ts');
    const menuActions = readFromUiRoot('presentation/components/GitMenuButton/hooks/useGitMenuActions.ts');

    expect(statusActions).toContain('runGitOperation');
    expect(statusActions).toContain("kind: 'publish'");
    expect(menuActions).toContain('runGitOperation');
    expect(menuActions).toContain("kind: 'publish'");
  });
});
