import * as fs from 'fs';
import * as path from 'path';
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
  async getGitStatus(projectId: string, userContext: UserContext, featureName?: string): Promise<{
    hasGit: boolean;
    hasCodebase: boolean;
    hasFeatures: boolean;
    currentBranch?: string;
  }> {
    try {
      const codebasePath = this.workspaceResolver.getCodebasePath(userContext, projectId, featureName);

      const hasCodebase = fs.existsSync(codebasePath);
      const gitDir = path.join(codebasePath, '.git');
      const hasGit = fs.existsSync(gitDir);
      
      // Check if features exist
      const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
      const featuresPath = path.join(projectPath, 'features');
      const hasFeatures = fs.existsSync(featuresPath) && 
        fs.readdirSync(featuresPath).filter(f => !f.startsWith('.')).length > 0;

      let currentBranch: string | undefined;
      if (hasGit) {
        try {
          // ✅ Ensure safe.directory is set (prevents "dubious ownership" error in cloud environments)
          await GitHelper.ensureSafeDirectory(codebasePath);
          
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
  async getGitChanges(projectId: string, userContext: UserContext, featureName?: string): Promise<{
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
      const codebasePath = this.workspaceResolver.getCodebasePath(userContext, projectId, featureName);

      // ✅ Ensure safe.directory is set (prevents "dubious ownership" error in cloud environments)
      await GitHelper.ensureSafeDirectory(codebasePath);

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

      const status = await git.status();
      
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
      const codebasePath = this.workspaceResolver.getCodebasePath(userContext, projectId);

      // Check if .git exists
      const gitDir = path.join(codebasePath, '.git');
      return fs.existsSync(gitDir);
    } catch (error) {
      console.error('[GitStatusService] Error checking clone status:', error);
      return false;
    }
  }
}
