import * as fs from 'fs';
import * as path from 'path';
import { SimpleGit } from 'simple-git';
import { WorkspaceResolver } from '../../../../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../../../../core/types/user';
import { GitHubAuthService } from '../../../../../auth/GitHubAuthService';
import { GitHelper } from '../../helper/GitHelper';
import { RemoteChecker } from '../helpers/RemoteChecker';
import { BaseGitSetupOperation } from './BaseGitSetupOperation';

/**
 * PublishOperation
 * 
 * Publishes an existing codebase (with features already created) to a new GitHub repository.
 * Unlike InitOperation, this allows features to already exist.
 * 
 * Key differences from InitOperation:
 * - Does NOT require workspace to be clean (features can exist)
 * - Creates feature branches for all existing features after pushing base branch
 * - Designed for the "work first, git later" workflow
 * 
 * Flow:
 * 1. Validate: Git not already initialized, remote repo doesn't exist
 * 2. git init with base branch
 * 3. Create .gitignore
 * 4. Initial commit with all existing code
 * 5. Create GitHub repository via API
 * 6. Push base branch
 * 7. Create and push feature branches for all existing features
 * 8. Checkout the current active feature's branch
 * 9. Trigger codebase indexing
 */
export class PublishOperation extends BaseGitSetupOperation {
  protected get operationName(): string {
    return 'PublishOperation';
  }

  constructor(
    workspaceResolver: WorkspaceResolver,
    githubAuthService?: GitHubAuthService,
    onIndexingTrigger?: (projectId: string, codebasePath: string, userContext: UserContext, feedbackFeature?: string) => void
  ) {
    super(workspaceResolver, githubAuthService, onIndexingTrigger);
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

    let gitInitialized = false;

    try {
      // Prepare codebase
      const hasFiles = await this.prepareCodebase(codebasePath, projectId);

      console.log(`[PublishOperation] Publishing existing codebase to Git at ${codebasePath}...`);

      // Get base branch from config
      const baseBranch = config.branchBase || 'main';
      
      // Initialize Git
      const git = await this.initializeGit(codebasePath, baseBranch, userContext);
      gitInitialized = true;

      // Create .gitignore
      await this.createGitignore(codebasePath);

      // Create initial commit
      await this.createInitialCommit(git, codebasePath, hasFiles);

      // Ensure on default branch
      const defaultBranch = await this.ensureDefaultBranch(git, baseBranch);

      // Create GitHub repo
      await this.createGitHubRepo(config.githubRepo, projectId, userContext);

      // Add remote and push base branch
      await this.addRemoteAndPush(git, defaultBranch, config, userContext);

      // Create feature branches for existing features
      if (existingFeatures.length > 0) {
        await this.createFeatureBranches(git, existingFeatures, defaultBranch, activeFeature);
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
   * Create feature branches for all existing features and push them.
   * Each feature branch is created from the base branch (identical content).
   * After publish, future work on features creates proper diffs.
   */
  private async createFeatureBranches(
    git: SimpleGit,
    features: string[],
    baseBranch: string,
    activeFeature?: string
  ): Promise<void> {
    console.log(`[PublishOperation] Creating ${features.length} feature branch(es)...`);

    for (const featureName of features) {
      const branchName = GitHelper.sanitizeBranchName(featureName);

      try {
        // Ensure we're on base branch before creating feature branch
        await git.checkout(baseBranch);
        
        // Create feature branch from base
        await git.checkoutLocalBranch(branchName);
        console.log(`[PublishOperation] ✅ Created branch: ${branchName}`);
        
        // Push feature branch
        await git.push(['-u', 'origin', branchName]);
        console.log(`[PublishOperation] ✅ Pushed branch: ${branchName}`);
      } catch (error: any) {
        console.error(`[PublishOperation] ⚠️  Failed to create/push branch ${branchName}:`, error.message);
        // Continue with other features - don't fail the whole operation
      }
    }

    // Checkout the active feature's branch, or the first feature, or base branch
    const targetFeature = activeFeature || features[0];
    if (targetFeature) {
      const targetBranch = GitHelper.sanitizeBranchName(targetFeature);
      try {
        await git.checkout(targetBranch);
        console.log(`[PublishOperation] ✅ Checked out active feature branch: ${targetBranch}`);
      } catch {
        // Fallback to base branch
        await git.checkout(baseBranch);
        console.log(`[PublishOperation] ⚠️  Fell back to base branch: ${baseBranch}`);
      }
    } else {
      await git.checkout(baseBranch);
    }
  }
}
