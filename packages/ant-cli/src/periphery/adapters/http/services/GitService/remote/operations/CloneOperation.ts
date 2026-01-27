import * as fs from 'fs';
import * as path from 'path';
import simpleGit from 'simple-git';
import { WorkspaceResolver } from '../../../../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../../../../core/types/user';
import { GitHubAuthService } from '../../../../../auth/GitHubAuthService';
import { GitHelper } from '../../helper/GitHelper';
import { SourceDetector } from '../helpers/SourceDetector';

/**
 * CloneOperation
 * 
 * Handles cloning of existing repository from GitHub.
 * 
 * Key features:
 * - Validates workspace is clean (no features, no files)
 * - Clones to temp directory with --depth 1
 * - Detects and flattens nested repository structures
 * - Sets upstream for default branch
 */
export class CloneOperation {
  constructor(
    private readonly workspaceResolver: WorkspaceResolver,
    private readonly githubAuthService?: GitHubAuthService
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

    // Determine codebase path based on repoType
    const codebasePath = this.resolveCodebasePath(projectPath, config);

    // Validate workspace is clean
    this.validateCleanWorkspace(projectPath, codebasePath);

    console.log(`[CloneOperation] Cloning repository from ${config.githubRepo}...`);

    // Build authenticated URL
    const credentialContext = {
      org: userContext.organizationId,
      user: userContext.userId
    };
    
    const authenticatedUrl = await this.githubAuthService.buildAuthenticatedUrl(
      credentialContext,
      config.githubRepo
    );

    // Create temp directory for cloning
    const tempPath = path.join(projectPath, '.temp-clone');
    
    // Ensure temp doesn't exist
    if (fs.existsSync(tempPath)) {
      await fs.promises.rm(tempPath, { recursive: true, force: true });
    }

    // Clone to temp directory
    // Note: Removing --depth 1 to allow full history and all branches
    const git = simpleGit();
    try {
      await git.clone(authenticatedUrl, tempPath);
      console.log(`[CloneOperation] ✅ Clone completed, analyzing structure...`);
    } catch (error: any) {
      const errorMsg = error.message || error.toString();
      
      if (errorMsg.includes('repository not found') || errorMsg.includes('does not appear to be a git repository')) {
        throw new Error(`Repository not found at ${config.githubRepo}. Please check the URL or use Initialize to create a new repository.`);
      } else if (errorMsg.includes('authentication failed')) {
        throw new Error('Authentication failed. Please check your GitHub PAT.');
      } else {
        throw new Error(`Clone failed: ${errorMsg}`);
      }
    }

    // Detect actual source root
    const sourceRoot = await SourceDetector.detect(tempPath);
    console.log(`[CloneOperation] Detected source root: ${sourceRoot || '(repo root)'}`);

    // Move source to codebase path
    await this.moveSourceToCodebase(tempPath, codebasePath, sourceRoot);

    // ✅ CRITICAL: Add to safe.directory BEFORE any git operations
    // This prevents "dubious ownership" error in cloud environments
    await GitHelper.ensureSafeDirectory(codebasePath);

    // Configure git user from UserContext (essential for cloud environments)
    await this.ensureGitUserConfig(codebasePath, userContext);

    // Set upstream for default branch
    await this.setupUpstream(codebasePath);

    console.log(`[CloneOperation] ✅ Repository cloned successfully`);
  }

  private async ensureGitUserConfig(codebasePath: string, userContext: UserContext): Promise<void> {
    const gitInstance = GitHelper.getGitInstanceSafe(codebasePath);
    if (gitInstance) {
      await GitHelper.ensureUserConfig(gitInstance, userContext);
    }
  }

  private resolveCodebasePath(projectPath: string, config: any): string {
    if (config.repoType === 'local') {
      if (!config.localPath) {
        throw new Error('Local path not configured');
      }
      // Resolve localPath (supports ~/, absolute, relative)
      return config.localPath.startsWith('~')
        ? config.localPath.replace('~', process.env.HOME || '')
        : path.isAbsolute(config.localPath)
        ? config.localPath
        : path.resolve(process.cwd(), config.localPath);
    } else {
      return path.join(projectPath, 'codebase');
    }
  }

  private validateCleanWorkspace(projectPath: string, codebasePath: string): void {
    // Check if already cloned
    const gitDir = path.join(codebasePath, '.git');
    if (fs.existsSync(gitDir)) {
      throw new Error('Repository already cloned. Delete .git directory to re-clone.');
    }

    // Check if features already exist (must be clean workspace)
    const featuresPath = path.join(projectPath, 'features');
    if (fs.existsSync(featuresPath)) {
      const features = fs.readdirSync(featuresPath).filter(f => !f.startsWith('.'));
      if (features.length > 0) {
        throw new Error('Cannot clone: Features already exist. Clone requires a clean workspace.');
      }
    }

    // Check if codebase directory has any files (must be clean)
    if (fs.existsSync(codebasePath)) {
      const files = fs.readdirSync(codebasePath).filter(f => !f.startsWith('.'));
      if (files.length > 0) {
        throw new Error('Cannot clone: Codebase directory is not empty. Clone requires a clean workspace.');
      }
    }
  }

  private async moveSourceToCodebase(
    tempPath: string,
    codebasePath: string,
    sourceRoot: string | null
  ): Promise<void> {
    // Create parent directory if needed
    await fs.promises.mkdir(path.dirname(codebasePath), { recursive: true });

    const sourcePath = sourceRoot ? path.join(tempPath, sourceRoot) : tempPath;
    
    if (sourceRoot) {
      // Flatten nested structure
      console.log(`[CloneOperation] Flattening nested structure: ${sourceRoot}/`);
      
      // Move nested source directory to codebase
      await fs.promises.rename(sourcePath, codebasePath);
      
      // Move .git from temp root to codebase
      const tempGitDir = path.join(tempPath, '.git');
      const codebaseGitDir = path.join(codebasePath, '.git');
      
      if (fs.existsSync(tempGitDir)) {
        await fs.promises.rename(tempGitDir, codebaseGitDir);
      } else {
        console.warn(`[CloneOperation] ⚠️  .git not found in temp directory`);
      }
      
      // Clean up temp
      await fs.promises.rm(tempPath, { recursive: true, force: true });
    } else {
      // Move entire repo (includes .git)
      await fs.promises.rename(tempPath, codebasePath);
    }

    // Verify .git exists in final location
    const finalGitDir = path.join(codebasePath, '.git');
    if (!fs.existsSync(finalGitDir)) {
      throw new Error('Clone completed but .git directory not found in final location');
    }
  }

  private async setupUpstream(codebasePath: string): Promise<void> {
    try {
      const gitInstance = GitHelper.getGitInstanceSafe(codebasePath);
      if (!gitInstance) {
        console.warn('[CloneOperation] Git not initialized, skipping upstream setup');
        return;
      }
      
      const currentBranch = await gitInstance.revparse(['--abbrev-ref', 'HEAD']);
      const branchClean = currentBranch.trim();
      
      // Check if upstream is already set
      let hasUpstream = false;
      try {
        await gitInstance.revparse(['--abbrev-ref', `${branchClean}@{upstream}`]);
        hasUpstream = true;
      } catch {
        hasUpstream = false;
      }
      
      if (!hasUpstream) {
        await gitInstance.branch(['--set-upstream-to', `origin/${branchClean}`, branchClean]);
        console.log(`[CloneOperation] ✅ Set upstream for default branch: ${branchClean} -> origin/${branchClean}`);
      }
    } catch (err) {
      console.warn('[CloneOperation] Could not set upstream:', err);
    }
  }
}

