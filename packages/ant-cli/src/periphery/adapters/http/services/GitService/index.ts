import type { GitStatusResponse, GitChangesResponse } from '@ant/shared';
import { WorkspaceResolver } from '../../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../../core/types/user';
import { GitHubAuthService } from '../../../auth/GitHubAuthService';
import { ChatService } from '../ChatService';
import { StatusService } from './status';
import { RemoteService } from './remote';
import { IndexService } from './indexing';

/**
 * GitService (Facade)
 * 
 * Main facade for all Git-related operations.
 * Provides a unified interface for status, remote, and indexing operations.
 * 
 * 📦 Architecture:
 * - StatusService: Git status queries
 * - RemoteService: Remote operations (clone, init, push, pull, fetch, sync)
 * - IndexService: AI/LLM indexing operations
 * 
 * Note: Branch switching is no longer needed. Each feature uses its own
 * Git worktree (managed by WorktreeService), so the correct branch is
 * always checked out in the worktree directory.
 */
export class GitService {
  private readonly status: StatusService;
  private readonly remote: RemoteService;
  private readonly index: IndexService;

  constructor(
    workspaceResolver: WorkspaceResolver,
    githubAuthService?: GitHubAuthService,
    chatService?: ChatService
  ) {
    this.status = new StatusService(workspaceResolver);
    this.index = new IndexService(workspaceResolver, chatService);
    
    // Remote service needs indexing callback
    this.remote = new RemoteService(
      workspaceResolver,
      githubAuthService,
      (projectId, codebasePath, userContext, feedbackFeature) => {
        this.index.autoIndexCodebase(projectId, codebasePath, userContext, feedbackFeature)
          .catch((err: any) => {
            console.error('⚠️  [GitService] Background indexing failed:', err);
          });
      }
    );
  }

  // =====================================
  // Status Operations
  // =====================================

  async getGitStatus(
    projectId: string,
    userContext: UserContext,
    featureName?: string,
  ): Promise<GitStatusResponse> {
    return this.status.getGitStatus(projectId, userContext, featureName);
  }

  async getGitChanges(
    projectId: string,
    userContext: UserContext,
    featureName?: string,
  ): Promise<GitChangesResponse> {
    return this.status.getGitChanges(projectId, userContext, featureName);
  }

  async checkCloneStatus(projectId: string, userContext: UserContext): Promise<boolean> {
    return this.status.checkCloneStatus(projectId, userContext);
  }

  // =====================================
  // Remote Operations
  // =====================================

  async cloneGitHubRepo(projectId: string, userContext: UserContext): Promise<{ warnings?: string[] }> {
    return this.remote.cloneGitHubRepo(projectId, userContext);
  }

  async initializeGitHubRepo(projectId: string, userContext: UserContext, activeFeature?: string): Promise<{ warnings?: string[] }> {
    return this.remote.initializeGitHubRepo(projectId, userContext, activeFeature);
  }

  async pushToGitHub(projectId: string, userContext: UserContext, featureName?: string): Promise<void> {
    return this.remote.pushToGitHub(projectId, userContext, featureName);
  }

  async pullFromGitHub(projectId: string, userContext: UserContext, featureName?: string): Promise<void> {
    return this.remote.pullFromGitHub(projectId, userContext, featureName);
  }

  async fetchFromGitHub(projectId: string, userContext: UserContext, featureName?: string): Promise<void> {
    return this.remote.fetchFromGitHub(projectId, userContext, featureName);
  }

  async syncWithRemote(projectId: string, userContext: UserContext, featureName?: string): Promise<{
    success: boolean;
    pulledChanges?: boolean;
    pushedChanges?: boolean;
  }> {
    return this.remote.syncWithRemote(projectId, userContext, featureName);
  }

  async commitChanges(
    projectId: string,
    userContext: UserContext,
    message?: string,
    featureName?: string,
    files?: string[]
  ): Promise<{ success: boolean; commitHash?: string }> {
    return this.remote.commitChanges(projectId, userContext, message, featureName, files);
  }

  async discardChanges(
    projectId: string,
    userContext: UserContext,
    featureName?: string,
    files?: string[]
  ): Promise<{ success: boolean; discardedFiles: number }> {
    return this.remote.discardChanges(projectId, userContext, featureName, files);
  }

  // =====================================
  // Indexing Operations
  // =====================================

  async autoIndexCodebase(
    projectId: string,
    codebasePath: string,
    userContext: UserContext,
    featureName?: string
  ): Promise<void> {
    return this.index.autoIndexCodebase(projectId, codebasePath, userContext, featureName);
  }
}

