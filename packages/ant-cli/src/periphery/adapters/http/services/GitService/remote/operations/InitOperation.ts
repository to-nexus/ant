import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceResolver } from '../../../../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../../../../core/types/user';
import { GitHubAuthService } from '../../../../../auth/GitHubAuthService';
import { GitHelper } from '../../helper/GitHelper';
import { RemoteChecker } from '../helpers/RemoteChecker';
import { BaseGitSetupOperation } from './BaseGitSetupOperation';

/**
 * InitOperation
 * 
 * Handles initialization of a new Git repository and pushing to GitHub.
 * Requires workspace to be clean (no features).
 * 
 * For initializing Git on a codebase that already has features,
 * use PublishOperation instead.
 * 
 * Key features:
 * - Validates workspace is clean (no features)
 * - Checks remote repository doesn't already exist
 * - Creates .gitignore based on project type
 * - Initializes Git with configured base branch
 * - Creates initial commit
 * - Creates GitHub repository
 * - Pushes to GitHub
 * - Clears Vector DB and triggers indexing
 */
export class InitOperation extends BaseGitSetupOperation {
  protected get operationName(): string {
    return 'InitOperation';
  }

  constructor(
    workspaceResolver: WorkspaceResolver,
    githubAuthService?: GitHubAuthService,
    onIndexingTrigger?: (projectId: string, codebasePath: string, userContext: UserContext, feedbackFeature?: string) => void
  ) {
    super(workspaceResolver, githubAuthService, onIndexingTrigger);
  }

  async execute(projectId: string, userContext: UserContext): Promise<void> {
    if (!this.githubAuthService) {
      throw new Error('GitHub integration not configured');
    }

    const { config, projectPath, codebasePath } = await this.loadConfig(projectId, userContext);

    // Validate workspace (requires no features for init)
    await this.validateWorkspace(projectPath, codebasePath, config.githubRepo, userContext);

    let gitInitialized = false;

    try {
      // Prepare codebase
      const hasFiles = await this.prepareCodebase(codebasePath, projectId);

      console.log(`[InitOperation] Initializing new Git repository at ${codebasePath}...`);

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

      // Add remote and push
      await this.addRemoteAndPush(git, defaultBranch, config, userContext);

      // Trigger indexing
      await this.triggerIndexing(projectId, codebasePath, userContext);
      
    } catch (error) {
      // Rollback: Remove Git initialization if it was created
      if (gitInitialized) {
        console.error('[InitOperation] ❌ Initialization failed, rolling back Git setup...');
        await this.rollback(codebasePath);
      }
      throw error;
    }
  }

  private async validateWorkspace(
    projectPath: string,
    codebasePath: string,
    githubRepo: string,
    userContext: UserContext
  ): Promise<void> {
    // Check if features already exist
    const featuresPath = path.join(projectPath, 'features');
    if (fs.existsSync(featuresPath)) {
      const features = fs.readdirSync(featuresPath).filter(f => !f.startsWith('.'));
      if (features.length > 0) {
        throw new Error(
          `Cannot initialize: ${features.length} feature(s) already exist. ` +
          `Git initialization must be done before creating features. ` +
          `Please delete features and re-initialize, or use Publish to push existing work to Git.`
        );
      }
    }

    // Check if Git is already initialized
    const existingGit = GitHelper.getGitInstanceSafe(codebasePath);
    if (existingGit) {
      throw new Error('Git repository already initialized. Use push/pull instead.');
    }

    // Check if remote repository already exists
    console.log(`[InitOperation] Checking if remote repository already exists...`);
    const repoExists = await RemoteChecker.exists(githubRepo, userContext, this.githubAuthService);
    
    if (repoExists) {
      throw new Error(`Remote repository already exists at ${githubRepo}. Please use Clone instead to download the existing repository.`);
    }
  }
}
