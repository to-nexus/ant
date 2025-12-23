import * as fs from 'fs';
import * as path from 'path';
import { SimpleGit } from 'simple-git';
import { WorkspaceResolver } from '../../../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../../../core/types/user';
import { GitHubAuthService } from '../../../../auth/GitHubAuthService';
import { SSEService } from '../../SSEService';
import { GitHelper } from './GitHelper';

/**
 * GitRemoteService
 * 
 * Handles Git remote operations (clone, init, push, pull, fetch, sync)
 */
export class GitRemoteService {
  private readonly workspaceResolver: WorkspaceResolver;
  private readonly githubAuthService?: GitHubAuthService;
  private readonly sseService?: SSEService;
  
  constructor(
    workspaceResolver: WorkspaceResolver,
    githubAuthService?: GitHubAuthService,
    sseService?: SSEService
  ) {
    this.workspaceResolver = workspaceResolver;
    this.githubAuthService = githubAuthService;
    this.sseService = sseService;
  }
  
  /**
   * Clone GitHub repository
   * TODO: Move implementation from ProjectService.ts line 548-710
   */
  async cloneGitHubRepo(projectId: string, userContext: UserContext): Promise<void> {
    throw new Error('Not implemented yet - to be migrated');
  }
  
  /**
   * Initialize GitHub repository
   * TODO: Move implementation from ProjectService.ts line 1212-1413
   */
  async initializeGitHubRepo(projectId: string, userContext: UserContext): Promise<void> {
    throw new Error('Not implemented yet - to be migrated');
  }
  
  /**
   * Push to GitHub
   */
  async pushToGitHub(projectId: string, userContext: UserContext): Promise<void> {
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

    // Get Git instance
    const git = GitHelper.getGitInstanceSafe(codebasePath);
    if (!git) {
      throw new Error('Repository not initialized. Please clone or initialize first.');
    }
    
    // Update remote URL
    const credentialContext = {
      org: userContext.organizationId,
      user: userContext.userId
    };
    const authenticatedUrl = await this.githubAuthService.buildAuthenticatedUrl(
      credentialContext,
      config.githubRepo
    );
    
    await git.remote(['set-url', 'origin', authenticatedUrl]).catch(() => {});
    
    // Get current branch
    const status = await git.status();
    const currentBranch = status.current;
    
    if (!currentBranch) {
      throw new Error('No branch to push');
    }
    
    // Check if there's anything to push
    if (status.ahead === 0) {
      console.log('[GitRemoteService] Nothing to push');
      return;
    }
    
    // Push
    console.log(`[GitRemoteService] Pushing ${currentBranch} to origin...`);
    await git.push('origin', currentBranch);
    console.log('[GitRemoteService] ✅ Push completed');
  }
  
  /**
   * Pull from GitHub
   */
  async pullFromGitHub(projectId: string, userContext: UserContext): Promise<void> {
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

    // Get Git instance
    const git = GitHelper.getGitInstanceSafe(codebasePath);
    if (!git) {
      throw new Error('Repository not initialized. Please clone or initialize first.');
    }
    
    // Update remote URL
    const credentialContext = {
      org: userContext.organizationId,
      user: userContext.userId
    };
    const authenticatedUrl = await this.githubAuthService.buildAuthenticatedUrl(
      credentialContext,
      config.githubRepo
    );
    
    await git.remote(['set-url', 'origin', authenticatedUrl]).catch(() => {});
    
    // Get current branch
    const status = await git.status();
    const currentBranch = status.current;
    
    if (!currentBranch) {
      throw new Error('No branch to pull');
    }
    
    // Check if there's anything to pull
    if (status.behind === 0) {
      console.log('[GitRemoteService] Already up to date');
      return;
    }
    
    // Pull
    console.log(`[GitRemoteService] Pulling ${currentBranch} from origin...`);
    await git.pull('origin', currentBranch);
    console.log('[GitRemoteService] ✅ Pull completed');
  }
  
  /**
   * Fetch from GitHub
   */
  async fetchFromGitHub(projectId: string, userContext: UserContext): Promise<void> {
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

    // Get Git instance
    const git = GitHelper.getGitInstanceSafe(codebasePath);
    if (!git) {
      throw new Error('Repository not initialized. Please clone or initialize first.');
    }

    // Build authenticated URL
    const credentialContext = {
      org: userContext.organizationId,
      user: userContext.userId
    };
    
    const authenticatedUrl = await this.githubAuthService.buildAuthenticatedUrl(
      credentialContext,
      config.githubRepo
    );

    // Update remote URL
    try {
      const remotes = await git.getRemotes(true);
      const originExists = remotes.some(r => r.name === 'origin');
      
      if (originExists) {
        await git.remote(['set-url', 'origin', authenticatedUrl]);
      } else {
        await git.addRemote('origin', authenticatedUrl);
      }
    } catch (error: any) {
      console.error('[GitRemoteService] Failed to update remote:', error.message);
      throw new Error('Failed to update remote configuration');
    }

    // Fetch
    try {
      await git.fetch('origin');
      
      // Auto-setup upstream if not configured but remote branch exists
      const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
      const currentBranchClean = currentBranch.trim();
      
      // Check if current branch has upstream
      let hasUpstream = false;
      try {
        await git.revparse(['--abbrev-ref', `${currentBranchClean}@{upstream}`]);
        hasUpstream = true;
      } catch {
        hasUpstream = false;
      }
      
      // If no upstream, check if remote branch exists with same name
      if (!hasUpstream) {
        try {
          const remoteBranches = await git.branch(['-r']);
          const remoteBranchName = `origin/${currentBranchClean}`;
          
          if (remoteBranches.all.includes(remoteBranchName)) {
            await git.branch(['--set-upstream-to', remoteBranchName, currentBranchClean]);
            console.log(`[GitRemoteService] ✅ Auto-configured upstream for ${currentBranchClean} -> ${remoteBranchName}`);
          }
        } catch (err) {
          console.log(`[GitRemoteService] Could not auto-setup upstream:`, err);
        }
      }
    } catch (error: any) {
      const errorMsg = error.message || error.toString();
      
      if (errorMsg.includes('authentication failed') || errorMsg.includes('could not read Username')) {
        throw new Error('Authentication failed. Please check your GitHub PAT.');
      } else {
        throw new Error(`Fetch failed: ${errorMsg}`);
      }
    }
  }
  
  /**
   * Sync with remote (commit + pull + push)
   * TODO: Move implementation from ProjectService.ts line 1034-1055
   */
  async syncWithRemote(projectId: string, userContext: UserContext): Promise<{
    success: boolean;
    pulledChanges?: boolean;
    pushedChanges?: boolean;
  }> {
    throw new Error('Not implemented yet - to be migrated');
  }
  
  /**
   * Commit changes
   * TODO: Move implementation from ProjectService.ts line 954-1033
   */
  async commitChanges(
    projectId: string,
    userContext: UserContext,
    message?: string
  ): Promise<{ success: boolean; commitHash?: string }> {
    throw new Error('Not implemented yet - to be migrated');
  }
}

