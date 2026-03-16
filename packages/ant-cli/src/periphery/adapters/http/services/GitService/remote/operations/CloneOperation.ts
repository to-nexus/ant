import * as fs from 'fs';
import * as path from 'path';
import simpleGit from 'simple-git';
import { WorkspaceResolver } from '../../../../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../../../../core/types/user';
import { GitHubAuthService } from '../../../../../auth/GitHubAuthService';
import { GitHelper } from '../../helper/GitHelper';
import { SourceDetector } from '../helpers/SourceDetector';
import { detectGitDefaultBranch } from '../../../../../../../core/utils/branchUtils';
import { WorktreeService } from '../../worktree';
import { FeatureCodebaseBackup } from '../../worktree/FeatureCodebaseBackup';
import { GitOperationError, GitAuthError, GitConflictError, GitNotFoundError } from '../../errors';

/**
 * CloneOperation
 * 
 * Clones an existing repository from GitHub.
 * Supports existing features: creates worktrees tracking remote branches if available.
 */
export class CloneOperation {
  private readonly featureBackup: FeatureCodebaseBackup;

  constructor(
    private readonly workspaceResolver: WorkspaceResolver,
    private readonly worktreeService: WorktreeService,
    private readonly githubAuthService?: GitHubAuthService
  ) {
    this.featureBackup = new FeatureCodebaseBackup(workspaceResolver);
  }

  async execute(projectId: string, userContext: UserContext): Promise<{ warnings?: string[] }> {
    if (!this.githubAuthService) {
      throw new GitOperationError('GitHub integration not configured');
    }

    const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
    const configPath = path.join(projectPath, 'config.json');
    
    if (!fs.existsSync(configPath)) {
      throw new GitNotFoundError('Project config not found');
    }

    const config = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
    
    if (!config.githubRepo) {
      throw new GitOperationError('GitHub repository not configured in project config');
    }

    const codebasePath = this.workspaceResolver.getCodebasePath(userContext, projectId);

    // Only check if git is already initialized
    const gitDir = path.join(codebasePath, '.git');
    if (fs.existsSync(gitDir)) {
      throw new GitConflictError('Repository already cloned. Delete .git directory to re-clone.');
    }

    // Read existing features and backup their codebases
    const existingFeatures = await this.readExistingFeatures(projectPath);
    const featureBackups = existingFeatures.length > 0
      ? await this.featureBackup.backup(projectId, existingFeatures, userContext)
      : new Map<string, string>();

    console.log(`[CloneOperation] Cloning repository from ${config.githubRepo}...`);

    const credentialContext = {
      org: userContext.organizationId,
      user: userContext.userId
    };
    
    const authenticatedUrl = await this.githubAuthService.buildAuthenticatedUrl(
      credentialContext,
      config.githubRepo
    );

    const tempPath = path.join(projectPath, '.temp-clone');
    
    if (fs.existsSync(tempPath)) {
      await fs.promises.rm(tempPath, { recursive: true, force: true });
    }

    const git = simpleGit();
    try {
      await git.clone(authenticatedUrl, tempPath);
      console.log(`[CloneOperation] Clone completed, analyzing structure...`);
    } catch (error: any) {
      const errorMsg = error.message || error.toString();
      const lower = errorMsg.toLowerCase();
      
      if (lower.includes('repository not found') || lower.includes('does not appear to be a git repository')) {
        throw new GitNotFoundError(`Repository not found at ${config.githubRepo}. Please check the URL or use Initialize to create a new repository.`);
      } else if (lower.includes('authentication failed') || lower.includes('could not read from remote repository')) {
        throw new GitAuthError('Authentication failed. Please check your GitHub PAT.');
      } else {
        throw new GitOperationError(`Clone failed: ${errorMsg}`);
      }
    }

    try {
      const sourceRoot = await SourceDetector.detect(tempPath);
      console.log(`[CloneOperation] Detected source root: ${sourceRoot || '(repo root)'}`);

      await this.moveSourceToCodebase(tempPath, codebasePath, sourceRoot);

      await GitHelper.ensureSafeDirectory(codebasePath);
      await this.ensureGitUserConfig(codebasePath, userContext);
      await this.setupUpstream(codebasePath);
      await this.syncDetectedBranchToConfig(codebasePath, configPath, config);

      let warnings: string[] | undefined;
      if (existingFeatures.length > 0) {
        warnings = await this.createFeatureWorktrees(projectId, existingFeatures, featureBackups, userContext);
      }

      console.log(`[CloneOperation] Repository cloned successfully`);
      return { warnings };
    } catch (error) {
      console.error('[CloneOperation] Post-clone processing failed, cleaning up...');
      try {
        if (fs.existsSync(codebasePath)) {
          await fs.promises.rm(codebasePath, { recursive: true, force: true });
        }
      } catch (cleanupErr: any) {
        console.error(`[CloneOperation] Cleanup failed: ${cleanupErr.message}`);
      }
      throw error;
    } finally {
      if (fs.existsSync(tempPath)) {
        await fs.promises.rm(tempPath, { recursive: true, force: true }).catch(() => {});
      }
      await this.featureBackup.cleanup(featureBackups);
    }
  }

  private async ensureGitUserConfig(codebasePath: string, userContext: UserContext): Promise<void> {
    const gitInstance = GitHelper.getGitInstanceSafe(codebasePath);
    if (gitInstance) {
      await GitHelper.ensureUserConfig(gitInstance, userContext);
    }
  }

  private async readExistingFeatures(projectPath: string): Promise<string[]> {
    const features = await FeatureCodebaseBackup.readExistingFeatures(projectPath);
    if (features.length > 0) {
      console.log(`[CloneOperation] Found ${features.length} existing feature(s): ${features.join(', ')}`);
    }
    return features;
  }

  private async createFeatureWorktrees(
    projectId: string,
    features: string[],
    featureBackups: Map<string, string>,
    userContext: UserContext
  ): Promise<string[] | undefined> {
    console.log(`[CloneOperation] Creating ${features.length} feature worktree(s)...`);
    const warnings: string[] = [];

    for (const featureName of features) {
      try {
        await this.worktreeService.createWorktree(projectId, featureName, userContext);

        const backupPath = featureBackups.get(featureName);
        if (backupPath && fs.existsSync(backupPath)) {
          const worktreePath = this.workspaceResolver.getCodebasePath(userContext, projectId, featureName);
          await this.featureBackup.restoreToWorktree(backupPath, worktreePath);
          console.log(`[CloneOperation] Restored code for feature: ${featureName}`);
        }
      } catch (error: any) {
        const msg = `Failed to create worktree for feature "${featureName}": ${error.message}`;
        console.error(`[CloneOperation] ${msg}`);
        warnings.push(msg);

        // Worktree creation failed — restore backup to original location so code is not lost
        const backupPath = featureBackups.get(featureName);
        if (backupPath && fs.existsSync(backupPath)) {
          try {
            const originalPath = this.workspaceResolver.getCodebasePath(userContext, projectId, featureName);
            await fs.promises.mkdir(originalPath, { recursive: true });
            await this.featureBackup.restoreToWorktree(backupPath, originalPath);
            console.log(`[CloneOperation] Restored code to original location for feature: ${featureName}`);
          } catch (restoreErr: any) {
            console.error(`[CloneOperation] Failed to restore code for feature "${featureName}": ${restoreErr.message}`);
          }
        }
      }
    }

    return warnings.length > 0 ? warnings : undefined;
  }

  private async moveSourceToCodebase(
    tempPath: string,
    codebasePath: string,
    sourceRoot: string | null
  ): Promise<void> {
    await fs.promises.mkdir(path.dirname(codebasePath), { recursive: true });

    const sourcePath = sourceRoot ? path.join(tempPath, sourceRoot) : tempPath;
    
    if (sourceRoot) {
      console.log(`[CloneOperation] Flattening nested structure: ${sourceRoot}/`);
      
      await fs.promises.rename(sourcePath, codebasePath);
      
      const tempGitDir = path.join(tempPath, '.git');
      const codebaseGitDir = path.join(codebasePath, '.git');
      
      if (fs.existsSync(tempGitDir)) {
        await fs.promises.rename(tempGitDir, codebaseGitDir);
      } else {
        console.warn(`[CloneOperation] .git not found in temp directory`);
      }
      
      await fs.promises.rm(tempPath, { recursive: true, force: true });
    } else {
      if (fs.existsSync(codebasePath)) {
        await fs.promises.rm(codebasePath, { recursive: true, force: true });
      }
      await fs.promises.rename(tempPath, codebasePath);
    }

    const finalGitDir = path.join(codebasePath, '.git');
    if (!fs.existsSync(finalGitDir)) {
      throw new GitOperationError('Clone completed but .git directory not found in final location');
    }
  }

  private async syncDetectedBranchToConfig(
    codebasePath: string,
    configPath: string,
    config: any,
  ): Promise<void> {
    try {
      const detected = await detectGitDefaultBranch(codebasePath);
      if (detected && detected !== config.branchBase) {
        config.branchBase = detected;
        await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
        console.log(`[CloneOperation] Auto-detected default branch: ${detected}`);
      }
    } catch (error) {
      console.warn('[CloneOperation] Could not auto-detect default branch:', error);
    }
  }

  private async setupUpstream(codebasePath: string): Promise<void> {
    try {
      const gitInstance = GitHelper.getGitInstanceSafe(codebasePath);
      if (!gitInstance) return;
      
      const currentBranch = await gitInstance.revparse(['--abbrev-ref', 'HEAD']);
      const branchClean = currentBranch.trim();
      
      let hasUpstream = false;
      try {
        await gitInstance.revparse(['--abbrev-ref', `${branchClean}@{upstream}`]);
        hasUpstream = true;
      } catch {
        hasUpstream = false;
      }
      
      if (!hasUpstream) {
        await gitInstance.branch(['--set-upstream-to', `origin/${branchClean}`, branchClean]);
        console.log(`[CloneOperation] Set upstream: ${branchClean} -> origin/${branchClean}`);
      }
    } catch (err) {
      console.warn('[CloneOperation] Could not set upstream:', err);
    }
  }
}
