import * as fs from 'fs';
import * as path from 'path';
import type { GitStatusResponse, GitChangesResponse, FileChange } from '@ant/shared';
import { WorkspaceResolver } from '../../../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../../../core/types/user';
import { GitHelper } from '../helper/GitHelper';

/**
 * StatusService
 *
 * Handles Git status queries and change detection.
 * Response shapes are defined in `@ant/shared/git` (contract SSOT).
 */
export class StatusService {
  private readonly workspaceResolver: WorkspaceResolver;

  constructor(workspaceResolver: WorkspaceResolver) {
    this.workspaceResolver = workspaceResolver;
  }

  async getGitStatus(
    projectId: string,
    userContext: UserContext,
    featureName?: string,
  ): Promise<GitStatusResponse> {
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
      if (error?.code === 'ENOENT' || error?.code === 'EACCES') {
        return { hasGit: false, hasCodebase: false, codebaseHasFiles: false, hasFeatures: false };
      }
      console.error('[GitStatusService] Error checking Git status:', error);
      throw error;
    }
  }

  async getGitChanges(
    projectId: string,
    userContext: UserContext,
    featureName?: string,
  ): Promise<GitChangesResponse> {
    try {
      const codebasePath = this.workspaceResolver.getCodebasePath(userContext, projectId, featureName);

      await GitHelper.ensureSafeDirectory(codebasePath);

      const git = GitHelper.getGitInstanceSafe(codebasePath);
      if (!git) {
        return {
          staged: [],
          unstaged: [],
          untracked: [],
          ahead: 0,
          behind: 0,
          isGitInitialized: false,
          hasUpstream: false,
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

      let ahead = status.ahead || 0;
      let behind = status.behind || 0;
      let hasUpstream = true;

      try {
        const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
        try {
          await git.revparse(['--abbrev-ref', `${currentBranch}@{upstream}`]);
        } catch {
          hasUpstream = false;
          ahead = 0;
          behind = 0;
        }
      } catch (branchError) {
        console.warn('[GitStatusService] Failed to get current branch:', branchError);
        hasUpstream = false;
        ahead = 0;
        behind = 0;
      }

      return {
        staged,
        unstaged,
        untracked,
        ahead,
        behind,
        isGitInitialized: true,
        hasUpstream,
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
      const gitDir = path.join(codebasePath, '.git');
      return fs.existsSync(gitDir);
    } catch (error) {
      console.error('[GitStatusService] Error checking clone status:', error);
      return false;
    }
  }
}
