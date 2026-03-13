import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceResolver } from '../../../../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../../../../core/types/user';
import { GitHubAuthService } from '../../../../../auth/GitHubAuthService';
import { GitHelper } from '../../helper/GitHelper';
import { RemoteChecker } from '../helpers/RemoteChecker';
import { BaseGitSetupOperation } from './BaseGitSetupOperation';
import { WorktreeService } from '../../worktree';
import { FeatureCodebaseBackup } from '../../worktree/FeatureCodebaseBackup';
import { GitOperationError, GitConflictError } from '../../errors';

/**
 * InitOperation
 * 
 * Initializes a new Git repository and pushes to GitHub.
 * Supports existing features: creates LOCAL worktrees for them after init.
 */
export class InitOperation extends BaseGitSetupOperation {
  private readonly worktreeService: WorktreeService;
  private readonly featureBackup: FeatureCodebaseBackup;

  protected get operationName(): string {
    return 'InitOperation';
  }

  constructor(
    workspaceResolver: WorkspaceResolver,
    worktreeService: WorktreeService,
    githubAuthService?: GitHubAuthService,
    onIndexingTrigger?: (projectId: string, codebasePath: string, userContext: UserContext, feedbackFeature?: string) => void
  ) {
    super(workspaceResolver, githubAuthService, onIndexingTrigger);
    this.worktreeService = worktreeService;
    this.featureBackup = new FeatureCodebaseBackup(workspaceResolver);
  }

  async execute(projectId: string, userContext: UserContext, activeFeature?: string): Promise<{ warnings?: string[] }> {
    if (!this.githubAuthService) {
      throw new GitOperationError('GitHub integration not configured');
    }

    const { config, projectPath, codebasePath } = await this.loadConfig(projectId, userContext);

    await this.validateWorkspace(codebasePath, config.githubRepo, userContext);

    const existingFeatures = await this.readExistingFeatures(projectPath);
    const featureBackups = existingFeatures.length > 0
      ? await this.featureBackup.backup(projectId, existingFeatures, userContext)
      : new Map<string, string>();

    const seedFeature = activeFeature && existingFeatures.includes(activeFeature)
      ? activeFeature
      : existingFeatures[0] || null;

    if (seedFeature) {
      await this.seedMainCodebase(projectId, seedFeature, codebasePath, userContext);
    }

    let gitInitialized = false;

    try {
      const hasFiles = await this.prepareCodebase(codebasePath, projectId);

      console.log(`[InitOperation] Initializing new Git repository at ${codebasePath}...`);

      const baseBranch = config.branchBase || 'main';
      const git = await this.initializeGit(codebasePath, baseBranch, userContext);
      gitInitialized = true;

      await this.createGitignore(codebasePath);
      await this.createInitialCommit(git, codebasePath, hasFiles);

      const defaultBranch = await this.ensureDefaultBranch(git, baseBranch);

      if (defaultBranch !== config.branchBase) {
        config.branchBase = defaultBranch;
        const configPath = path.join(projectPath, 'config.json');
        await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
        console.log(`[InitOperation] Updated branchBase in config: ${defaultBranch}`);
      }

      await this.createGitHubRepo(config.githubRepo, projectId, userContext);
      await this.addRemoteAndPush(git, defaultBranch, config, userContext);

      let warnings: string[] | undefined;
      if (existingFeatures.length > 0) {
        warnings = await this.createFeatureWorktrees(projectId, existingFeatures, featureBackups, userContext);
      }

      await this.triggerIndexing(projectId, codebasePath, userContext);
      return { warnings };
    } catch (error) {
      if (gitInitialized) {
        console.error('[InitOperation] Initialization failed, rolling back Git setup...');
        await this.rollback(codebasePath);
      }
      throw error;
    } finally {
      await this.featureBackup.cleanup(featureBackups);
    }
  }

  private async validateWorkspace(
    codebasePath: string,
    githubRepo: string,
    userContext: UserContext
  ): Promise<void> {
    const existingGit = GitHelper.getGitInstanceSafe(codebasePath);
    if (existingGit) {
      throw new GitConflictError('Git repository already initialized. Use push/pull instead.');
    }

    console.log(`[InitOperation] Checking if remote repository already exists...`);
    const repoExists = await RemoteChecker.exists(githubRepo, userContext, this.githubAuthService);
    
    if (repoExists) {
      throw new GitConflictError(`Remote repository already exists at ${githubRepo}. Please use Clone instead to download the existing repository.`);
    }
  }

  private async createFeatureWorktrees(
    projectId: string,
    features: string[],
    featureBackups: Map<string, string>,
    userContext: UserContext
  ): Promise<string[] | undefined> {
    console.log(`[InitOperation] Creating ${features.length} feature worktree(s)...`);
    const warnings: string[] = [];

    for (const featureName of features) {
      try {
        await this.worktreeService.createWorktree(projectId, featureName, userContext);

        const backupPath = featureBackups.get(featureName);
        if (backupPath && fs.existsSync(backupPath)) {
          const worktreePath = this.workspaceResolver.getCodebasePath(userContext, projectId, featureName);
          await this.featureBackup.restoreToWorktree(backupPath, worktreePath);
          console.log(`[InitOperation] Restored code for feature: ${featureName}`);
        }
      } catch (error: any) {
        const msg = `Failed to create worktree for feature "${featureName}": ${error.message}`;
        console.error(`[InitOperation] ${msg}`);
        warnings.push(msg);
      }
    }

    return warnings.length > 0 ? warnings : undefined;
  }
}
