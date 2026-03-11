import * as fs from 'fs';
import * as path from 'path';
import simpleGit from 'simple-git';
import { WorkspaceResolver } from '../../../../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../../../../core/types/user';
import { GitHubAuthService } from '../../../../../auth/GitHubAuthService';
import { GitHelper } from '../../helper/GitHelper';
import { RemoteChecker } from '../helpers/RemoteChecker';
import { BaseGitSetupOperation } from './BaseGitSetupOperation';
import { WorktreeService } from '../../worktree';

/**
 * PublishOperation
 * 
 * Publishes an existing codebase (with features already created) to a new GitHub repository.
 * Designed for the "work first, git later" workflow using Git worktrees.
 * 
 * Key behaviors:
 * - Does NOT require workspace to be clean (features can exist with code)
 * - Seeds main codebase (base branch) from the active feature's code
 * - Creates Git worktrees for all existing features (no branch checkout)
 * - Each feature's existing code is preserved and committed to its worktree branch
 * 
 * Flow:
 * 1. Validate: Git not already initialized, remote repo doesn't exist
 * 2. Backup all feature codebase directories
 * 3. Seed projectPath/codebase/ with active feature's code (base branch content)
 * 4. git init + .gitignore + initial commit
 * 5. Create GitHub repository + push base branch
 * 6. For each feature: create worktree -> restore backed-up code -> commit -> push
 * 7. Clean up backup directories
 * 8. Trigger codebase indexing
 */
export class PublishOperation extends BaseGitSetupOperation {
  private readonly worktreeService: WorktreeService;

  protected get operationName(): string {
    return 'PublishOperation';
  }

  constructor(
    workspaceResolver: WorkspaceResolver,
    worktreeService: WorktreeService,
    githubAuthService?: GitHubAuthService,
    onIndexingTrigger?: (projectId: string, codebasePath: string, userContext: UserContext, feedbackFeature?: string) => void
  ) {
    super(workspaceResolver, githubAuthService, onIndexingTrigger);
    this.worktreeService = worktreeService;
  }

  async execute(projectId: string, userContext: UserContext, activeFeature?: string): Promise<void> {
    if (!this.githubAuthService) {
      throw new Error('GitHub integration not configured');
    }

    const { config, projectPath, codebasePath } = await this.loadConfig(projectId, userContext);

    // Validate (no feature-existence check, unlike InitOperation)
    await this.validate(codebasePath, config.githubRepo, userContext);

    // Read existing features before Git operations
    const existingFeatures = await this.readExistingFeatures(projectPath);

    // Backup feature codebase directories before Git operations may alter them
    const featureBackups = await this.backupFeatureCodebases(projectId, existingFeatures, userContext);

    // Determine which feature's code to seed the base branch with
    const seedFeature = activeFeature && existingFeatures.includes(activeFeature)
      ? activeFeature
      : existingFeatures[0] || null;

    // Seed main codebase from the seed feature's code (if main codebase is empty)
    if (seedFeature) {
      await this.seedMainCodebase(projectId, seedFeature, codebasePath, userContext);
    }

    let gitInitialized = false;

    try {
      // Prepare codebase (creates dir + README if empty)
      const hasFiles = await this.prepareCodebase(codebasePath, projectId);

      console.log(`[PublishOperation] Publishing existing codebase to Git at ${codebasePath}...`);

      // Get base branch from config
      const baseBranch = config.branchBase || 'main';

      // Initialize Git in main codebase
      const git = await this.initializeGit(codebasePath, baseBranch, userContext);
      gitInitialized = true;

      // Create .gitignore
      await this.createGitignore(codebasePath);

      // Create initial commit
      await this.createInitialCommit(git, codebasePath, hasFiles);

      // Ensure on default branch
      const defaultBranch = await this.ensureDefaultBranch(git, baseBranch);

      // Sync detected branch back to config if it differs
      if (defaultBranch !== config.branchBase) {
        config.branchBase = defaultBranch;
        const configPath = path.join(projectPath, 'config.json');
        await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
        console.log(`[PublishOperation] 🔍 Updated branchBase in config: ${defaultBranch}`);
      }

      // Create GitHub repo
      await this.createGitHubRepo(config.githubRepo, projectId, userContext);

      // Add remote and push base branch
      await this.addRemoteAndPush(git, defaultBranch, config, userContext);

      // Create feature worktrees and restore code (replaces old createFeatureBranches)
      if (existingFeatures.length > 0) {
        await this.createFeatureWorktrees(
          projectId,
          existingFeatures,
          featureBackups,
          userContext
        );
      }

      // Trigger indexing
      await this.triggerIndexing(projectId, codebasePath, userContext);

    } catch (error) {
      // Rollback: Remove Git initialization if it was created
      if (gitInitialized) {
        console.error('[PublishOperation] ❌ Publish failed, rolling back Git setup...');
        await this.rollback(codebasePath);
      }
      throw error;
    } finally {
      // Always clean up backup directories
      await this.cleanupBackups(featureBackups);
    }
  }

  /**
   * Validate preconditions for publish.
   * Unlike InitOperation, does NOT check for existing features.
   */
  private async validate(
    codebasePath: string,
    githubRepo: string,
    userContext: UserContext
  ): Promise<void> {
    // Check if Git is already initialized
    const existingGit = GitHelper.getGitInstanceSafe(codebasePath);
    if (existingGit) {
      throw new Error('Git repository already initialized. Use push/pull instead.');
    }

    // Check if remote repository already exists
    console.log(`[PublishOperation] Checking if remote repository already exists...`);
    const repoExists = await RemoteChecker.exists(githubRepo, userContext, this.githubAuthService);

    if (repoExists) {
      throw new Error(
        `Remote repository already exists at ${githubRepo}. ` +
        `Publishing is only supported for new repositories. ` +
        `To connect to an existing repository, please use Clone instead.`
      );
    }
  }

  /**
   * Read existing feature names from the features directory
   */
  private async readExistingFeatures(projectPath: string): Promise<string[]> {
    const featuresPath = path.join(projectPath, 'features');

    if (!fs.existsSync(featuresPath)) {
      return [];
    }

    const baseBranchNames = ['main', 'master', 'develop'];
    const items = await fs.promises.readdir(featuresPath);
    const features: string[] = [];

    for (const item of items) {
      if (item.startsWith('.')) continue;
      const itemPath = path.join(featuresPath, item);
      const stat = await fs.promises.stat(itemPath);
      if (stat.isDirectory() && !baseBranchNames.includes(item.toLowerCase())) {
        features.push(item);
      }
    }

    console.log(`[PublishOperation] Found ${features.length} existing feature(s): ${features.join(', ') || '(none)'}`);
    return features;
  }

  /**
   * Backup all feature codebase directories to sibling .codebase-backup/ locations.
   * Returns a map of featureName -> backupPath for restoration after worktree creation.
   * 
   * This is necessary because WorktreeService.createWorktree() deletes the existing
   * codebase directory before creating the worktree.
   */
  private async backupFeatureCodebases(
    projectId: string,
    features: string[],
    userContext: UserContext
  ): Promise<Map<string, string>> {
    const backups = new Map<string, string>();

    for (const featureName of features) {
      const featureCodebasePath = this.workspaceResolver.getCodebasePath(userContext, projectId, featureName);

      if (!fs.existsSync(featureCodebasePath)) continue;

      const files = await fs.promises.readdir(featureCodebasePath);
      if (files.length === 0) continue;

      // Backup to sibling directory: features/{name}/.codebase-backup/
      const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
      const backupPath = path.join(featurePath, '.codebase-backup');

      console.log(`[PublishOperation] Backing up ${featureName} codebase (${files.length} items) -> ${backupPath}`);
      await fs.promises.cp(featureCodebasePath, backupPath, { recursive: true });
      backups.set(featureName, backupPath);
    }

    if (backups.size > 0) {
      console.log(`[PublishOperation] ✅ Backed up ${backups.size} feature codebase(s)`);
    }

    return backups;
  }

  /**
   * Seed the main codebase directory with the seed feature's code.
   * This becomes the initial content of the base branch.
   * Only seeds if the main codebase is empty or doesn't exist.
   */
  private async seedMainCodebase(
    projectId: string,
    seedFeature: string,
    codebasePath: string,
    userContext: UserContext
  ): Promise<void> {
    // Check if main codebase already has files (skip seeding if so)
    if (fs.existsSync(codebasePath)) {
      const existingFiles = await fs.promises.readdir(codebasePath);
      if (existingFiles.length > 0) {
        console.log(`[PublishOperation] Main codebase already has files, skipping seed from feature`);
        return;
      }
    }

    const featureCodebasePath = this.workspaceResolver.getCodebasePath(userContext, projectId, seedFeature);

    if (!fs.existsSync(featureCodebasePath)) return;

    const files = await fs.promises.readdir(featureCodebasePath);
    if (files.length === 0) return;

    // Ensure main codebase directory exists
    await fs.promises.mkdir(codebasePath, { recursive: true });

    // Copy seed feature's code to main codebase
    console.log(`[PublishOperation] Seeding main codebase from feature: ${seedFeature}`);
    await fs.promises.cp(featureCodebasePath, codebasePath, { recursive: true });
    console.log(`[PublishOperation] ✅ Main codebase seeded with ${files.length} items from ${seedFeature}`);
  }

  /**
   * Create Git worktrees for all existing features, restore their backed-up code,
   * and commit+push the feature-specific changes.
   * 
   * Each worktree starts from the base branch content. After restoring the
   * feature's original code, any differences from base are committed and pushed.
   */
  private async createFeatureWorktrees(
    projectId: string,
    features: string[],
    featureBackups: Map<string, string>,
    userContext: UserContext
  ): Promise<void> {
    console.log(`[PublishOperation] Creating ${features.length} feature worktree(s)...`);

    for (const featureName of features) {
      const branchName = GitHelper.sanitizeBranchName(featureName);

      try {
        // Create worktree via WorktreeService (handles branch creation + remote push)
        await this.worktreeService.createWorktree(projectId, featureName, userContext);
        console.log(`[PublishOperation] ✅ Created worktree for: ${featureName}`);

        // Restore backed-up code if available
        const backupPath = featureBackups.get(featureName);
        if (backupPath && fs.existsSync(backupPath)) {
          const worktreePath = this.workspaceResolver.getCodebasePath(userContext, projectId, featureName);

          // Clear worktree content (except .git file) and restore backup
          await this.restoreToWorktree(backupPath, worktreePath);

          // Commit and push the feature-specific changes
          const worktreeGit = simpleGit({ baseDir: worktreePath });
          await GitHelper.ensureSafeDirectory(worktreePath);
          await GitHelper.ensureUserConfig(worktreeGit, userContext);

          await worktreeGit.add('.');
          const status = await worktreeGit.status();

          if (status.files.length > 0) {
            await worktreeGit.commit(`feat(${featureName}): initial code from feature`);
            await worktreeGit.push(['-u', 'origin', branchName]);
            console.log(`[PublishOperation] ✅ Committed and pushed feature code: ${featureName} (${status.files.length} files)`);
          } else {
            console.log(`[PublishOperation] No diff from base for: ${featureName} (code identical)`);
          }
        }
      } catch (error: any) {
        console.error(`[PublishOperation] ⚠️ Failed to create worktree for ${featureName}:`, error.message);
        // Continue with other features - don't fail the whole operation
      }
    }
  }

  /**
   * Restore backed-up files into a worktree directory.
   * Clears existing content (except .git file used by worktrees) before restoring.
   */
  private async restoreToWorktree(backupPath: string, worktreePath: string): Promise<void> {
    // Remove existing files in worktree (except .git which is a file, not dir, for worktrees)
    const existingItems = await fs.promises.readdir(worktreePath);
    for (const item of existingItems) {
      if (item === '.git') continue; // Preserve worktree's .git reference
      await fs.promises.rm(path.join(worktreePath, item), { recursive: true, force: true });
    }

    // Copy backup content into worktree
    const backupItems = await fs.promises.readdir(backupPath);
    for (const item of backupItems) {
      if (item === '.git') continue; // Don't overwrite .git
      await fs.promises.cp(
        path.join(backupPath, item),
        path.join(worktreePath, item),
        { recursive: true }
      );
    }
  }

  /**
   * Clean up all backup directories created during publish.
   */
  private async cleanupBackups(featureBackups: Map<string, string>): Promise<void> {
    for (const [featureName, backupPath] of featureBackups) {
      try {
        if (fs.existsSync(backupPath)) {
          await fs.promises.rm(backupPath, { recursive: true, force: true });
        }
      } catch (error: any) {
        console.warn(`[PublishOperation] ⚠️ Failed to clean up backup for ${featureName}: ${error.message}`);
      }
    }
  }
}
