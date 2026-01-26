import * as fs from 'fs';
import * as path from 'path';
import { SimpleGit } from 'simple-git';
import { WorkspaceResolver } from '../../../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../../../core/types/user';
import { GitHelper } from '../helper/GitHelper';

/**
 * StatusService
 * 
 * Handles Git status queries and change detection
 */
export class StatusService {
  private readonly workspaceResolver: WorkspaceResolver;
  
  constructor(workspaceResolver: WorkspaceResolver) {
    this.workspaceResolver = workspaceResolver;
  }
  
  /**
   * Get Git status (hasGit, hasCodebase, hasFeatures, currentBranch)
   */
  async getGitStatus(projectId: string, userContext: UserContext): Promise<{
    hasGit: boolean;
    hasCodebase: boolean;
    hasFeatures: boolean;
    currentBranch?: string;
  }> {
    try {
      const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
      const configPath = path.join(projectPath, 'config.json');
      
      if (!fs.existsSync(configPath)) {
        return { hasGit: false, hasCodebase: false, hasFeatures: false };
      }

      const config = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
      
      // Determine codebase path
      let codebasePath: string;
      if (config.repoType === 'local') {
        if (!config.localPath) {
          return { hasGit: false, hasCodebase: false, hasFeatures: false };
        }
        codebasePath = config.localPath.startsWith('~')
          ? config.localPath.replace('~', process.env.HOME || '')
          : path.isAbsolute(config.localPath)
          ? config.localPath
          : path.resolve(process.cwd(), config.localPath);
      } else {
        codebasePath = path.join(projectPath, 'codebase');
      }

      const hasCodebase = fs.existsSync(codebasePath);
      const gitDir = path.join(codebasePath, '.git');
      const hasGit = fs.existsSync(gitDir);
      
      // Check if features exist
      const featuresPath = path.join(projectPath, 'features');
      const hasFeatures = fs.existsSync(featuresPath) && 
        fs.readdirSync(featuresPath).filter(f => !f.startsWith('.')).length > 0;

      let currentBranch: string | undefined;
      if (hasGit) {
        try {
          const git = GitHelper.getGitInstanceSafe(codebasePath);
          if (git) {
            currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
          }
        } catch (error) {
          console.warn('[GitStatusService] Failed to get current branch:', error);
        }
      }

      return { hasGit, hasCodebase, hasFeatures, currentBranch };
    } catch (error) {
      console.error('[GitStatusService] Error checking Git status:', error);
      return { hasGit: false, hasCodebase: false, hasFeatures: false };
    }
  }
  
  /**
   * Get Git changes with detailed file status and ahead/behind information
   */
  async getGitChanges(projectId: string, userContext: UserContext): Promise<{
    hasChanges: boolean;
    staged: string[];
    unstaged: string[];
    untracked: string[];
    ahead: number;
    behind: number;
    currentBranch?: string;
    isGitInitialized?: boolean;
    error?: string;
  }> {
    try {
      const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
      const configPath = path.join(projectPath, 'config.json');
      
      if (!fs.existsSync(configPath)) {
        throw new Error('Project config not found');
      }

      const config = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
      
      // Determine codebase path
      let codebasePath: string;
      if (config.repoType === 'local') {
        if (!config.localPath) {
          throw new Error('Local path not configured');
        }
        codebasePath = config.localPath.startsWith('~')
          ? config.localPath.replace('~', process.env.HOME || '')
          : path.isAbsolute(config.localPath)
          ? config.localPath
          : path.resolve(process.cwd(), config.localPath);
      } else {
        codebasePath = path.join(projectPath, 'codebase');
      }

      // Use GitHelper to safely get Git instance
      const git = GitHelper.getGitInstanceSafe(codebasePath);
      if (!git) {
        return {
          hasChanges: false,
          staged: [],
          unstaged: [],
          untracked: [],
          ahead: 0,
          behind: 0,
          isGitInitialized: false
        };
      }

      let status;
      try {
        status = await git.status();
      } catch (statusError: any) {
        // Handle "dubious ownership" error gracefully (shared EFS volumes)
        if (statusError.message?.includes('dubious ownership')) {
          console.warn(`[GitStatusService] Dubious ownership error for ${codebasePath} - returning empty status`);
          return {
            hasChanges: false,
            staged: [],
            unstaged: [],
            untracked: [],
            ahead: 0,
            behind: 0,
            currentBranch: undefined,
            isGitInitialized: true,
            error: 'dubious_ownership'
          };
        }
        throw statusError;
      }
      
      const staged = status.staged || [];
      const modified = status.modified || [];
      const deleted = status.deleted || [];
      const untracked = status.not_added || [];
      
      const unstaged = [...modified, ...deleted];
      
      const hasChanges = 
        staged.length > 0 || 
        modified.length > 0 || 
        deleted.length > 0 || 
        untracked.length > 0 ||
        status.ahead > 0 ||
        status.behind > 0;

      let ahead = status.ahead || 0;
      let behind = status.behind || 0;
      
      // Get current branch
      let currentBranch: string | undefined;
      try {
        currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
        
        // Check if upstream is set
        try {
          await git.revparse(['--abbrev-ref', `${currentBranch}@{upstream}`]);
        } catch (upstreamError) {
          console.log(`[GitStatusService] ⚠️  No upstream detected for ${currentBranch}`);
          console.log(`[GitStatusService] No upstream - resetting ahead/behind to 0 (data unreliable)`);
          ahead = 0;
          behind = 0;
        }
      } catch (branchError) {
        console.warn('[GitStatusService] Failed to get current branch:', branchError);
      }

      return {
        hasChanges,
        staged,
        unstaged,
        untracked,
        ahead,
        behind,
        currentBranch,
        isGitInitialized: true
      };
    } catch (error) {
      console.error('[GitStatusService] Error getting Git changes:', error);
      throw error;
    }
  }
  
  /**
   * Check if GitHub repository clone is complete
   */
  async checkCloneStatus(projectId: string, userContext: UserContext): Promise<boolean> {
    try {
      const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
      const configPath = path.join(projectPath, 'config.json');
      
      if (!fs.existsSync(configPath)) {
        return false;
      }

      const config = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
      
      // Determine codebase path
      let codebasePath: string;
      if (config.repoType === 'local') {
        return true; // Local repos are always "ready"
      } else {
        codebasePath = path.join(projectPath, 'codebase');
      }

      // Check if .git exists
      const gitDir = path.join(codebasePath, '.git');
      return fs.existsSync(gitDir);
    } catch (error) {
      console.error('[GitStatusService] Error checking clone status:', error);
      return false;
    }
  }
}
