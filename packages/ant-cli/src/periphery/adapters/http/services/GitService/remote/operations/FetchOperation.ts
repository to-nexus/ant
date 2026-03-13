import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceResolver } from '../../../../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../../../../core/types/user';
import { GitHubAuthService } from '../../../../../auth/GitHubAuthService';
import { GitHelper } from '../../helper/GitHelper';
import { logger } from '../../../../../../../utils/logger';
import { detectGitDefaultBranch } from '../../../../../../../core/utils/branchUtils';
import { GitOperationError } from '../../errors';
import { loadGitHubConfig, ensureRemote } from '../helpers/configLoader';

/**
 * FetchOperation
 * 
 * Handles fetching from GitHub (without merging).
 */
export class FetchOperation {
  constructor(
    private readonly workspaceResolver: WorkspaceResolver,
    private readonly githubAuthService?: GitHubAuthService
  ) {}

  async execute(projectId: string, userContext: UserContext, featureName?: string): Promise<void> {
    if (!this.githubAuthService) {
      throw new GitOperationError('GitHub integration not configured');
    }

    const codebasePath = this.workspaceResolver.getCodebasePath(userContext, projectId, featureName);
    const config = await loadGitHubConfig(this.workspaceResolver, projectId, userContext);

    await GitHelper.ensureSafeDirectory(codebasePath);

    const git = GitHelper.getGitInstanceSafe(codebasePath);
    if (!git) {
      throw new GitOperationError('Repository not initialized. Please clone or initialize first.');
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

