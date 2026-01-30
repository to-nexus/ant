import * as fs from 'fs';
import * as path from 'path';
import simpleGit, { SimpleGit } from 'simple-git';
import { WorkspaceResolver } from '../../../../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../../../../core/types/user';
import { GitHubAuthService } from '../../../../../auth/GitHubAuthService';
import { GitHelper } from '../../helper/GitHelper';
import { GitignoreGenerator } from '../helpers/GitignoreGenerator';
import { RemoteChecker } from '../helpers/RemoteChecker';

/**
 * InitOperation
 * 
 * Handles initialization of a new Git repository and pushing to GitHub.
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
export class InitOperation {
  constructor(
    private readonly workspaceResolver: WorkspaceResolver,
    private readonly githubAuthService?: GitHubAuthService,
    private readonly onIndexingTrigger?: (projectId: string, codebasePath: string, userContext: UserContext, feedbackFeature?: string) => void
  ) {}

  async execute(projectId: string, userContext: UserContext): Promise<void> {
    if (!this.githubAuthService) {
      throw new Error('GitHub integration not configured');
    }

    const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
    const configPath = path.join(projectPath, 'config.json');
    
    if (!fs.existsSync(configPath)) {
      throw new Error('Project config not found');
    }

    const config = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
    
    if (!config.githubRepo) {
      throw new Error('GitHub repository not configured in project config');
    }

    // Determine codebase path
    const codebasePath = this.resolveCodebasePath(projectPath, config);

    // Validate workspace
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

      // Build authenticated URL and add remote
      const credentialContext = {
        org: userContext.organizationId,
        user: userContext.userId
      };
      const authenticatedUrl = await this.githubAuthService.buildAuthenticatedUrl(
        credentialContext,
        config.githubRepo
      );

      await git.addRemote('origin', authenticatedUrl);
      console.log('[InitOperation] ✅ Remote added');

      // Create GitHub repository
      await this.createGitHubRepo(config.githubRepo, projectId, userContext);

      // Push and index
      await this.pushAndIndex(git, defaultBranch, projectId, codebasePath, userContext);
      
    } catch (error) {
      // Rollback: Remove Git initialization if it was created
      if (gitInitialized) {
        console.error('[InitOperation] ❌ Initialization failed, rolling back Git setup...');
        await this.rollback(codebasePath);
      }
      throw error;
    }
  }

  private resolveCodebasePath(projectPath: string, config: any): string {
    if (config.repoType === 'local') {
      if (!config.localPath) {
        throw new Error('Local path not configured');
      }
      return config.localPath.startsWith('~')
        ? config.localPath.replace('~', process.env.HOME || '')
        : path.isAbsolute(config.localPath)
        ? config.localPath
        : path.resolve(process.cwd(), config.localPath);
    } else {
      return path.join(projectPath, 'codebase');
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
          `Please delete features and re-initialize, or clone the repository instead.`
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

  private async prepareCodebase(codebasePath: string, projectId: string): Promise<boolean> {
    // Ensure codebase directory exists
    if (!fs.existsSync(codebasePath)) {
      await fs.promises.mkdir(codebasePath, { recursive: true });
    }

    // Check if codebase has files
    const files = await fs.promises.readdir(codebasePath);
    const hasFiles = files.length > 0;

    if (!hasFiles) {
      // Create README.md if empty
      const readmePath = path.join(codebasePath, 'README.md');
      const readmeContent = `# ${projectId}\n\nGenerated by ANT\n\n## Getting Started\n\nThis project was created using ANT CLI.\n`;
      await fs.promises.writeFile(readmePath, readmeContent, 'utf-8');
    }

    return hasFiles;
  }

  private async initializeGit(codebasePath: string, baseBranch: string, userContext: UserContext): Promise<SimpleGit> {
    const git = simpleGit({
      baseDir: codebasePath,
      binary: 'git',
      maxConcurrentProcesses: 6
    });
    
    await git.init([`--initial-branch=${baseBranch}`]);
    
    // Verify .git was created
    const gitDir = path.join(codebasePath, '.git');
    if (!fs.existsSync(gitDir)) {
      throw new Error(`Git initialization failed: .git not found in ${codebasePath}`);
    }

    // ✅ CRITICAL: Add to safe.directory BEFORE any git operations
    // This prevents "dubious ownership" error in cloud environments
    await GitHelper.ensureSafeDirectory(codebasePath);
    
    // Configure git user from UserContext (essential for cloud environments)
    await GitHelper.ensureUserConfig(git, userContext);
    
    console.log('[InitOperation] ✅ Git initialized');
    return git;
  }

  private async createGitignore(codebasePath: string): Promise<void> {
    const gitignorePath = path.join(codebasePath, '.gitignore');
    
    if (!fs.existsSync(gitignorePath)) {
      console.log(`[InitOperation] Creating .gitignore at ${gitignorePath}`);
      
      const gitignoreContent = await GitignoreGenerator.generate(codebasePath);
      await fs.promises.writeFile(gitignorePath, gitignoreContent, 'utf-8');
      
      console.log(`[InitOperation] ✅ .gitignore created`);
    } else {
      console.log(`[InitOperation] .gitignore already exists, skipping creation`);
    }
  }

  private async createInitialCommit(git: SimpleGit, codebasePath: string, hasFiles: boolean): Promise<void> {
    await git.add('.');
    const status = await git.status();
    
    if (status.files.length > 0) {
      const commitMessage = hasFiles 
        ? 'Initial commit with existing code'
        : 'Initial commit from ANT';
      await git.commit(commitMessage);
      console.log(`[InitOperation] ✅ Initial commit created: "${commitMessage}"`);
    } else {
      // Create .gitkeep if no files
      const gitkeepPath = path.join(codebasePath, '.gitkeep');
      await fs.promises.writeFile(gitkeepPath, '');
      await git.add('.gitkeep');
      await git.commit('Initial commit from ANT');
      console.log('[InitOperation] ✅ Initial commit created (empty)');
    }
  }

  private async ensureDefaultBranch(git: SimpleGit, baseBranch: string): Promise<string> {
    let defaultBranch = baseBranch;
    
    try {
      defaultBranch = await git.raw(['config', '--get', 'init.defaultBranch']);
      defaultBranch = defaultBranch.trim() || baseBranch;
    } catch {
      defaultBranch = baseBranch;
    }

    const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
    if (currentBranch.trim() !== defaultBranch) {
      await git.branch(['-M', defaultBranch]);
      console.log(`[InitOperation] Renamed branch to ${defaultBranch}`);
    }

    return defaultBranch;
  }

  private async createGitHubRepo(githubRepo: string, projectId: string, userContext: UserContext): Promise<void> {
    console.log(`[InitOperation] Creating GitHub repository at ${githubRepo}...`);
    
    try {
      await this.githubAuthService!.createRepo(
        userContext,
        githubRepo,
        {
          description: `${projectId} - Generated by ANT`,
          private: true
        }
      );
      console.log('[InitOperation] ✅ GitHub repository created');
    } catch (error: any) {
      const errorMsg = error.message || error.toString();
      if (!errorMsg.includes('already exists') && !errorMsg.includes('name already exists')) {
        console.warn('[InitOperation] Could not create GitHub repo:', errorMsg);
      }
    }
  }

  private async pushAndIndex(
    git: SimpleGit,
    defaultBranch: string,
    projectId: string,
    codebasePath: string,
    userContext: UserContext
  ): Promise<void> {
    console.log(`[InitOperation] Pushing to remote...`);
    
    try {
      await git.push(['-u', 'origin', defaultBranch]);
      console.log('[InitOperation] ✅ Pushed to remote');
      
      // Set upstream explicitly
      await git.branch(['--set-upstream-to', `origin/${defaultBranch}`, defaultBranch]);
      console.log(`[InitOperation] ✅ Upstream configured: ${defaultBranch} -> origin/${defaultBranch}`);
      
      // Clear Vector DB
      console.log(`[InitOperation] 🗑️  Clearing Vector DB for fresh start...`);
      const { AdapterFactory } = await import('../../../../../../../infrastructure/adapters/AdapterFactory');
      const vectorDB = AdapterFactory.createMemoryAdapter();
      await vectorDB.clear(projectId);
      console.log(`[InitOperation] ✅ Vector DB cleared`);
      
      // Trigger indexing
      if (this.onIndexingTrigger) {
        console.log(`[InitOperation] 🔍 Starting codebase indexing...`);
        const feedbackFeature = 'main';
        
        setImmediate(() => {
          this.onIndexingTrigger!(projectId, codebasePath, userContext, feedbackFeature);
        });
        
        console.log(`[InitOperation] ✅ Git initialization complete, indexing started in background`);
      }
      
    } catch (error: any) {
      const errorMsg = error.message || error.toString();
      
      if (errorMsg.includes('already exists') && errorMsg.includes('repository')) {
        console.log(`[InitOperation] Repository already exists, attempting push...`);
        try {
          await git.push(['-u', 'origin', defaultBranch]);
          console.log(`[InitOperation] ✅ Pushed to existing repository`);
          
          if (this.onIndexingTrigger) {
            console.log(`[InitOperation] 🔍 Starting codebase indexing...`);
            setImmediate(() => {
              this.onIndexingTrigger!(projectId, codebasePath, userContext);
            });
          }
        } catch (pushError: any) {
          throw new Error(`Failed to push to existing repository: ${pushError.message}`);
        }
      } else if (errorMsg.includes('authentication failed')) {
        throw new Error('Authentication failed. Please check your GitHub PAT.');
      } else {
        throw new Error(`Failed to initialize and push: ${errorMsg}`);
      }
    }
  }

  /**
   * Rollback Git initialization
   * Removes .git directory and .gitignore file
   */
  private async rollback(codebasePath: string): Promise<void> {
    try {
      // Remove .git directory
      const gitDir = path.join(codebasePath, '.git');
      if (fs.existsSync(gitDir)) {
        await fs.promises.rm(gitDir, { recursive: true, force: true });
        console.log('[InitOperation] 🔄 Rolled back: .git directory removed');
      }

      // Remove .gitignore
      const gitignorePath = path.join(codebasePath, '.gitignore');
      if (fs.existsSync(gitignorePath)) {
        await fs.promises.unlink(gitignorePath);
        console.log('[InitOperation] 🔄 Rolled back: .gitignore removed');
      }

      // Keep README.md as it might have been user-created
      console.log('[InitOperation] ✅ Rollback complete');
    } catch (error) {
      console.error('[InitOperation] ⚠️ Rollback failed:', error);
      // Don't throw - rollback is best-effort
    }
  }
}

