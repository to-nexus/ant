import { WorkspaceResolver } from '../../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../../core/types/user';
import { GitHubAuthService } from '../../../auth/GitHubAuthService';
import { ChatService } from '../ChatService';
import { BranchService } from './branch';
import { StatusService } from './status';
import { RemoteService } from './remote';
import { IndexService } from './indexing';

/**
 * GitService (Facade)
 * 
 * Main facade for all Git-related operations.
 * Provides a unified interface for branch, status, remote, and indexing operations.
 * 
 * 📦 Architecture:
 * - BranchService: Branch switching and stash management
 * - StatusService: Git status queries
 * - RemoteService: Remote operations (clone, init, push, pull, fetch, sync)
 * - IndexService: AI/LLM indexing operations
 */
export class GitService {
  private readonly branch: BranchService;
  private readonly status: StatusService;
  private readonly remote: RemoteService;
  private readonly index: IndexService;

  constructor(
    workspaceResolver: WorkspaceResolver,
    githubAuthService?: GitHubAuthService,
    chatService?: ChatService
  ) {
    this.branch = new BranchService(workspaceResolver, githubAuthService);
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
  // Branch Operations
  // =====================================

  async switchToFeatureBranch(
    projectId: string,
    featureName: string,
    userContext: UserContext
  ): Promise<{ branchName: string; currentBranch: string }> {
    return this.branch.switchToFeatureBranch(projectId, featureName, userContext);
  }

  // =====================================
  // Status Operations
  // =====================================

  async getGitStatus(projectId: string, userContext: UserContext): Promise<{
    hasGit: boolean;
    hasCodebase: boolean;
    hasFeatures: boolean;
    currentBranch?: string;
  }> {
    return this.status.getGitStatus(projectId, userContext);
  }

  async getGitChanges(projectId: string, userContext: UserContext): Promise<{
    hasChanges: boolean;
    staged: string[];
    unstaged: string[];
    untracked: string[];
    ahead: number;
    behind: number;
    currentBranch?: string;
    isGitInitialized?: boolean;
  }> {
    return this.status.getGitChanges(projectId, userContext);
  }

  async checkCloneStatus(projectId: string, userContext: UserContext): Promise<boolean> {
    return this.status.checkCloneStatus(projectId, userContext);
  }

  // =====================================
  // Remote Operations
  // =====================================

  async cloneGitHubRepo(projectId: string, userContext: UserContext): Promise<void> {
    return this.remote.cloneGitHubRepo(projectId, userContext);
  }

  async initializeGitHubRepo(projectId: string, userContext: UserContext): Promise<void> {
    return this.remote.initializeGitHubRepo(projectId, userContext);
  }

  async pushToGitHub(projectId: string, userContext: UserContext): Promise<void> {
    return this.remote.pushToGitHub(projectId, userContext);
  }

  async pullFromGitHub(projectId: string, userContext: UserContext): Promise<void> {
    return this.remote.pullFromGitHub(projectId, userContext);
  }

  async fetchFromGitHub(projectId: string, userContext: UserContext, featureName?: string): Promise<void> {
    return this.remote.fetchFromGitHub(projectId, userContext, featureName);
  }

  async syncWithRemote(projectId: string, userContext: UserContext): Promise<{
    success: boolean;
    pulledChanges?: boolean;
    pushedChanges?: boolean;
  }> {
    return this.remote.syncWithRemote(projectId, userContext);
  }

  async commitChanges(
    projectId: string,
    userContext: UserContext,
    message?: string
  ): Promise<{ success: boolean; commitHash?: string }> {
    return this.remote.commitChanges(projectId, userContext, message);
  }

  async publishToGitHub(projectId: string, userContext: UserContext, activeFeature?: string): Promise<void> {
    return this.remote.publishToGitHub(projectId, userContext, activeFeature);
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

