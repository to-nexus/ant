import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceResolver } from '../../../../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../../../../core/types/user';
import { GitHubAuthService } from '../../../../../auth/GitHubAuthService';
import { GitHelper } from '../../helper/GitHelper';

/**
 * SyncOperation
 * 
 * Handles syncing with GitHub (fetch + pull + push).
 */
export class SyncOperation {
  constructor(
    private readonly workspaceResolver: WorkspaceResolver,
    private readonly githubAuthService?: GitHubAuthService
  ) {}

  async execute(projectId: string, userContext: UserContext, featureName?: string): Promise<{
    success: boolean;
    pulledChanges?: boolean;
    pushedChanges?: boolean;
  }> {
    if (!this.githubAuthService) {
      throw new Error('GitHub integration not configured');
    }

    const codebasePath = this.workspaceResolver.getCodebasePath(userContext, projectId, featureName);
    const config = await this.loadGitHubConfig(projectId, userContext);

    // ✅ Ensure safe.directory is set (prevents "dubious ownership" error in cloud environments)
    await GitHelper.ensureSafeDirectory(codebasePath);

    const git = GitHelper.getGitInstanceSafe(codebasePath);
    if (!git) {
      throw new Error('Repository not initialized. Please clone or initialize first.');
    }

    // Update remote URL
    const credentialContext = {
      org: userContext.organizationId,
      user: userContext.userId
    };
    const authenticatedUrl = await this.githubAuthService.buildAuthenticatedUrl(
      credentialContext,
      config.githubRepo
    );
    
    await git.remote(['set-url', 'origin', authenticatedUrl]).catch(() => {});

    // Get current branch
    const status = await git.status();
    const currentBranch = status.current;
    
    if (!currentBranch) {
      throw new Error('No branch to sync');
    }

    let pulledChanges = false;
    let pushedChanges = false;

    // Fetch
    console.log(`[SyncOperation] Fetching from origin...`);
    await git.fetch('origin');

    // Pull if behind
    if (status.behind > 0) {
      console.log(`[SyncOperation] Pulling from origin/${currentBranch}...`);
      await git.pull('origin', currentBranch);
      pulledChanges = true;
      console.log('[SyncOperation] ✅ Pull completed');
    }

    // Push if ahead
    if (status.ahead > 0) {
      console.log(`[SyncOperation] Pushing ${currentBranch} to origin...`);
      await git.push('origin', currentBranch);
      pushedChanges = true;
      console.log('[SyncOperation] ✅ Push completed');
    }

    if (!pulledChanges && !pushedChanges) {
      console.log('[SyncOperation] Already in sync');
    }

    return { success: true, pulledChanges, pushedChanges };
  }

  private async loadGitHubConfig(projectId: string, userContext: UserContext) {
    const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
    const configPath = path.join(projectPath, 'config.json');
    
    if (!fs.existsSync(configPath)) {
      throw new Error('Project config not found');
    }

    const config = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
    
    if (!config.githubRepo) {
      throw new Error('GitHub repository not configured in project config');
    }

    return config;
  }
}

