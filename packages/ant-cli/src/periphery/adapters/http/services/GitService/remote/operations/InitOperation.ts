import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceResolver } from '../../../../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../../../../core/types/user';
import { GitHubAuthService } from '../../../../../auth/GitHubAuthService';
import type { SimpleGit } from 'simple-git';
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

    // Check for existing local git before validation
    const existingGit = GitHelper.getGitInstanceSafe(codebasePath);
    await this.validateWorkspace(codebasePath, existingGit, config.githubRepo, userContext);

    const existingFeatures = await this.readExistingFeatures(projectPath);
    const featureBackups = existingFeatures.length > 0
      ? await this.featureBackup.backup(projectId, existingFeatures, userContext)
      : new Map<string, string>();

    const seedFeature = activeFeature && existingFeatures.includes(activeFeature)
      ? activeFeature
      : existingFeatures[0] || null;

    // Only seed main codebase when there is no existing local git
    // (if git exists, the codebase already has content and history)
    if (seedFeature && !existingGit) {
      await this.seedMainCodebase(projectId, seedFeature, codebasePath, userContext);
    }

    let gitInitialized = false;

    try {
      const baseBranch = config.branchBase || 'main';
      let git: SimpleGit;

      if (existingGit) {
        // Reuse existing local git (no remote yet) — skip git init and initial commit
        console.log(`[InitOperation] Reusing existing local git, connecting to GitHub...`);
        git = existingGit;
        await GitHelper.ensureSafeDirectory(codebasePath);
        await GitHelper.ensureUserConfig(git, userContext);
        await this.createGitignore(codebasePath); // idempotent: skips if already exists
      } else {
        const hasFiles = await this.prepareCodebase(codebasePath, projectId);
        console.log(`[InitOperation] Initializing new Git repository at ${codebasePath}...`);
        git = await this.initializeGit(codebasePath, baseBranch, userContext);
        gitInitialized = true;
        await this.createGitignore(codebasePath);
        await this.createInitialCommit(git, codebasePath, hasFiles);
      }

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
    existingGit: SimpleGit | null,
    githubRepo: string,
    userContext: UserContext
  ): Promise<void> {
    if (existingGit) {
      // Local git exists — allow only if it has no remote (local-only repo from project creation)
      const remotes = await existingGit.getRemotes();
      if (remotes.length > 0) {
        throw new GitConflictError('Git repository already initialized. Use push/pull instead.');
      }
      console.log(`[InitOperation] Local git found (no remote), will connect to GitHub.`);
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
