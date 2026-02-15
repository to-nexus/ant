import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceResolver } from '../../../../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../../../../core/types/user';
import { GitHubAuthService } from '../../../../../auth/GitHubAuthService';
import { GitHelper } from '../../helper/GitHelper';
import { logger } from '../../../../../../../utils/logger';

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

    // Fetch
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

