import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceResolver } from '../../../../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../../../../core/types/user';
import { GitHubAuthService } from '../../../../../auth/GitHubAuthService';
import { WorktreeService } from '../../worktree';
import { FeatureCodebaseBackup } from '../../worktree/FeatureCodebaseBackup';
import { logger } from '../../../../../../../utils/logger';
import { detectGitDefaultBranch } from '../../../../../../../core/utils/branchUtils';
import { GitOperationError } from '../../errors';
import { loadGitHubConfig, ensureRemote } from '../helpers/configLoader';
import { GitBootstrapSSOT } from './BaseGitSetupOperation';
import { ensureGitRepository } from './helpers/ensureGitRepository';

/**
 * FetchOperation
 * 
 * Handles fetching from GitHub (without merging).
 */
export class FetchOperation {
  private readonly featureBackup: FeatureCodebaseBackup;
  private readonly gitBootstrap: GitBootstrapSSOT;

  constructor(
    private readonly workspaceResolver: WorkspaceResolver,
    private readonly worktreeService: WorktreeService,
    private readonly githubAuthService?: GitHubAuthService
  ) {
    this.featureBackup = new FeatureCodebaseBackup(workspaceResolver);
    this.gitBootstrap = new GitBootstrapSSOT(workspaceResolver, 'FetchOperation');
  }

  async execute(projectId: string, userContext: UserContext, featureName?: string): Promise<void> {
    if (!this.githubAuthService) {
      throw new GitOperationError('GitHub integration not configured');
    }

    const config = await loadGitHubConfig(this.workspaceResolver, projectId, userContext);
    const { git, codebasePath } = await ensureGitRepository({
      workspaceResolver: this.workspaceResolver,
      gitBootstrap: this.gitBootstrap,
      projectId,
      userContext,
      featureName,
      operationName: 'FetchOperation',
      worktreeService: this.worktreeService,
      featureBackup: this.featureBackup,
    });

    // Update remote URL
    const credentialContext = {
      org: userContext.organizationId,
      user: userContext.userId
    };
    const authenticatedUrl = await this.githubAuthService.buildAuthenticatedUrl(
      credentialContext,
      config.githubRepo
    );
    
    await ensureRemote(git, authenticatedUrl);

    logger.info(`[FetchOperation] Fetching from origin...`, {
      component: 'FetchOperation',
      organizationId: userContext.organizationId,
      userId: userContext.userId,
      projectId,
      featureName
    }, {
      githubRepo: config.githubRepo,
      codebasePath
    });
    await git.fetch('origin');
    logger.info('[FetchOperation] ✅ Fetch completed', {
      component: 'FetchOperation',
      organizationId: userContext.organizationId,
      userId: userContext.userId,
      projectId,
      featureName
    }, {
      githubRepo: config.githubRepo
    });

    // Re-detect default branch from remote HEAD (may have changed on GitHub)
    await this.syncDefaultBranch(codebasePath, projectId, userContext, config);
  }

  private async syncDefaultBranch(
    codebasePath: string,
    projectId: string,
    userContext: UserContext,
    config: any,
  ): Promise<void> {
    try {
      const detected = await detectGitDefaultBranch(codebasePath);
      if (detected && detected !== config.branchBase) {
        const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
        const configPath = path.join(projectPath, 'config.json');
        config.branchBase = detected;
        await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
        logger.info(`[FetchOperation] Updated branchBase: ${detected}`, {
          component: 'FetchOperation',
          organizationId: userContext.organizationId,
          userId: userContext.userId,
          projectId
        });
      }
    } catch (error) {
      logger.warn('[FetchOperation] Could not re-detect default branch', {
        component: 'FetchOperation',
        organizationId: userContext.organizationId,
        userId: userContext.userId,
        projectId
      });
    }
  }

}

