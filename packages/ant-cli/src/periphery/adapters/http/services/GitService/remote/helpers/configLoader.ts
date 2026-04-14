import * as fs from 'fs';
import * as path from 'path';
import type { SimpleGit } from 'simple-git';
import { WorkspaceResolver } from '../../../../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../../../../core/types/user';
import { GitOperationError, GitNotFoundError } from '../../errors';

export async function loadGitHubConfig(
  workspaceResolver: WorkspaceResolver,
  projectId: string,
  userContext: UserContext
): Promise<{ githubRepo: string; branchBase?: string; [key: string]: any }> {
  const projectPath = workspaceResolver.getProjectPath(userContext, projectId);
  const configPath = path.join(projectPath, 'config.json');

  if (!fs.existsSync(configPath)) {
    throw new GitNotFoundError('Project config not found');
  }

  const config = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));

  if (!config.githubRepo) {
    throw new GitOperationError('GitHub repository not configured in project config');
  }

  return config;
}

/**
 * Verify that remote "origin" exists, then update its URL.
 * Throws instead of silently swallowing errors.
 */
export async function ensureRemote(git: SimpleGit, authenticatedUrl: string): Promise<void> {
  const remotes = await git.getRemotes(true);
  if (remotes.some(r => r.name === 'origin')) {
    await git.remote(['set-url', 'origin', authenticatedUrl]);
  } else {
    throw new GitOperationError('No remote "origin" configured. Please clone or initialize first.');
  }
}
