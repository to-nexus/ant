import * as fs from 'fs';
import { WorkspaceResolver } from '../../../../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../../../../core/types/user';
import { GitHubAuthService } from '../../../../../auth/GitHubAuthService';
import { GitHelper } from '../../helper/GitHelper';
import { WorktreeService } from '../../worktree';
import { FeatureCodebaseBackup } from '../../worktree/FeatureCodebaseBackup';
import { GitOperationError } from '../../errors';
import { loadGitHubConfig, ensureRemote } from '../helpers/configLoader';

/**
 * PushOperation
 * 
 * Handles pushing changes to GitHub.
 * Includes lazy worktree creation and automatic upstream setup ("Publish Branch").
 */
export class PushOperation {
  private readonly featureBackup: FeatureCodebaseBackup;

  constructor(
    private readonly workspaceResolver: WorkspaceResolver,
    private readonly worktreeService: WorktreeService,
    private readonly githubAuthService?: GitHubAuthService
  ) {
    this.featureBackup = new FeatureCodebaseBackup(workspaceResolver);
  }

  async execute(projectId: string, userContext: UserContext, featureName?: string): Promise<void> {
    if (!this.githubAuthService) {
      throw new GitOperationError('GitHub integration not configured');
    }

    const codebasePath = this.workspaceResolver.getCodebasePath(userContext, projectId, featureName);
    const config = await loadGitHubConfig(this.workspaceResolver, projectId, userContext);

    await GitHelper.ensureSafeDirectory(codebasePath);

    let git = GitHelper.getGitInstanceSafe(codebasePath);
    
    if (!git && featureName) {
      console.log(`[PushOperation] No git found for feature ${featureName}, creating worktree lazily...`);
      const backups = await this.featureBackup.backup(projectId, [featureName], userContext);
      try {
        await this.worktreeService.createWorktree(projectId, featureName, userContext);
        const backupPath = backups.get(featureName);
        if (backupPath && fs.existsSync(backupPath)) {
          await this.featureBackup.restoreToWorktree(backupPath, codebasePath);
        }
      } finally {
        await this.featureBackup.cleanup(backups);
      }
      await GitHelper.ensureSafeDirectory(codebasePath);
      git = GitHelper.getGitInstanceSafe(codebasePath);
    }
    
    if (!git) {
      throw new GitOperationError('Repository not initialized. Please clone or initialize first.');
    }

    const credentialContext = {
      org: userContext.organizationId,
      user: userContext.userId
    };
    const authenticatedUrl = await this.githubAuthService.buildAuthenticatedUrl(
      credentialContext,
      config.githubRepo
    );
    
    await ensureRemote(git, authenticatedUrl);

    const status = await git.status();
    const currentBranch = status.current;
    
    if (!currentBranch) {
      throw new GitOperationError('No branch to push');
    }

    // Check upstream and push accordingly
    let hasUpstream = true;
    try {
      await git.revparse(['--abbrev-ref', `${currentBranch}@{upstream}`]);
    } catch {
      hasUpstream = false;
    }

    if (!hasUpstream) {
      // "Publish Branch" — first push with upstream setup
      console.log(`[PushOperation] Publishing branch ${currentBranch} to origin...`);
      await git.push(['-u', 'origin', currentBranch]);
      console.log('[PushOperation] Branch published successfully');
    } else {
      if (status.ahead === 0) {
        console.log('[PushOperation] Nothing to push');
        return;
      }
      console.log(`[PushOperation] Pushing ${currentBranch} to origin...`);
      await git.push('origin', currentBranch);
      console.log('[PushOperation] Push completed');
    }
  }

}
