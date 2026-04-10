import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceResolver } from '../../../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../../../core/types/user';
import { GitHelper } from '../helper/GitHelper';

export interface FileChange {
  path: string;
  status: 'modified' | 'deleted' | 'new' | 'renamed';
}

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
    codebaseHasFiles: boolean;
    hasFeatures: boolean;
    currentBranch?: string;
    remoteUrl?: string;
  }> {
    try {
      const codebasePath = this.workspaceResolver.getCodebasePath(userContext, projectId, featureName);

      const hasCodebase = fs.existsSync(codebasePath);
      const gitDir = path.join(codebasePath, '.git');
      const hasGit = fs.existsSync(gitDir);

      let codebaseHasFiles = false;
      if (hasCodebase) {
        try {
          const items = fs.readdirSync(codebasePath);
          codebaseHasFiles = items.some(name => !name.startsWith('.') && name !== 'node_modules');
        } catch { /* empty */ }
      }
      
      // Check if features exist
      const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
      const featuresPath = path.join(projectPath, 'features');
      const hasFeatures = fs.existsSync(featuresPath) && 
        fs.readdirSync(featuresPath).filter(f => !f.startsWith('.')).length > 0;

      let currentBranch: string | undefined;
      let remoteUrl: string | undefined;
      if (hasGit) {
        try {
          await GitHelper.ensureSafeDirectory(codebasePath);
          
          const git = GitHelper.getGitInstanceSafe(codebasePath);
          if (git) {
            currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
            
            try {
              const raw = await git.remote(['get-url', 'origin']);
              if (raw) {
                remoteUrl = raw.trim()
                  .replace(/\/\/[^@]+@/, '//')
                  .replace(/\.git$/, '');
              }
            } catch { /* no remote configured */ }
          }
        } catch (error) {
          console.warn('[GitStatusService] Failed to get current branch:', error);
        }
      }

      return { hasGit, hasCodebase, codebaseHasFiles, hasFeatures, currentBranch, remoteUrl };
    } catch (error: any) {
      // ENOENT/EACCES are expected when project path doesn't exist yet
      if (error?.code === 'ENOENT' || error?.code === 'EACCES') {
        return { hasGit: false, hasCodebase: false, codebaseHasFiles: false, hasFeatures: false };
      }
      console.error('[GitStatusService] Error checking Git status:', error);
      throw error;
    }
  }
  
  /**
   * Get Git changes with detailed file status and ahead/behind information
   */
  async getGitChanges(projectId: string, userContext: UserContext, featureName?: string): Promise<{
    hasChanges: boolean;
    staged: FileChange[];
    unstaged: FileChange[];
    untracked: FileChange[];
    ahead: number;
    behind: number;
    currentBranch?: string;
    isGitInitialized?: boolean;
    hasUpstream?: boolean;
    error?: string;
  }> {
    try {
      const codebasePath = this.workspaceResolver.getCodebasePath(userContext, projectId, featureName);

      await GitHelper.ensureSafeDirectory(codebasePath);

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

      const staged: FileChange[] = [];
      const unstaged: FileChange[] = [];
      const untracked: FileChange[] = [];

      for (const file of status.files) {
        if (file.index === '?' && file.working_dir === '?') {
          untracked.push({ path: file.path, status: 'new' });
          continue;
        }
        if (file.index && file.index !== ' ' && file.index !== '?') {
          const st = file.index === 'A' ? 'new' as const
            : file.index === 'D' ? 'deleted' as const
            : file.index === 'R' ? 'renamed' as const
            : 'modified' as const;
          staged.push({ path: file.path, status: st });
        }
        if (file.working_dir && file.working_dir !== ' ' && file.working_dir !== '?') {
          const st = file.working_dir === 'D' ? 'deleted' as const : 'modified' as const;
          unstaged.push({ path: file.path, status: st });
        }
      }

      const totalChanges = staged.length + unstaged.length + untracked.length;
      
      const hasChanges = 
        totalChanges > 0 ||
        status.ahead > 0 ||
        status.behind > 0;

      let ahead = status.ahead || 0;
      let behind = status.behind || 0;
      let hasUpstream = true;
      
      let currentBranch: string | undefined;
      try {
        currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
        
        try {
          await git.revparse(['--abbrev-ref', `${currentBranch}@{upstream}`]);
        } catch {
          hasUpstream = false;
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
        isGitInitialized: true,
        hasUpstream
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
