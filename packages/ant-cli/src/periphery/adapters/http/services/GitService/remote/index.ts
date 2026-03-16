import { WorkspaceResolver } from '../../../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../../../core/types/user';
import { GitHubAuthService } from '../../../../auth/GitHubAuthService';
import { CloneOperation } from './operations/CloneOperation';
import { InitOperation } from './operations/InitOperation';
import { PushOperation } from './operations/PushOperation';
import { PullOperation } from './operations/PullOperation';
import { FetchOperation } from './operations/FetchOperation';
import { SyncOperation } from './operations/SyncOperation';
import { CommitOperation } from './operations/CommitOperation';
import { DiscardOperation } from './operations/DiscardOperation';
import { WorktreeService } from '../worktree';

/**
 * RemoteService (Facade)
 * 
 * Main facade for Git remote operations.
 * Delegates to specific operation classes.
 */
export class RemoteService {
  private readonly inFlightFetch = new Map<string, Promise<void>>();
  private readonly inFlightClone = new Map<string, Promise<{ warnings?: string[] }>>();
  private readonly inFlightInit = new Map<string, Promise<{ warnings?: string[] }>>();

  private readonly cloneOp: CloneOperation;
  private readonly initOp: InitOperation;
  private readonly pushOp: PushOperation;
  private readonly pullOp: PullOperation;
  private readonly fetchOp: FetchOperation;
  private readonly syncOp: SyncOperation;
  private readonly commitOp: CommitOperation;
  private readonly discardOp: DiscardOperation;

  constructor(
    workspaceResolver: WorkspaceResolver,
    githubAuthService?: GitHubAuthService,
    onIndexingTrigger?: (projectId: string, codebasePath: string, userContext: UserContext, feedbackFeature?: string) => void
  ) {
    const worktreeService = new WorktreeService(workspaceResolver, githubAuthService);

    this.cloneOp = new CloneOperation(workspaceResolver, worktreeService, githubAuthService);
    this.initOp = new InitOperation(workspaceResolver, worktreeService, githubAuthService, onIndexingTrigger);
    this.pushOp = new PushOperation(workspaceResolver, worktreeService, githubAuthService);
    this.pullOp = new PullOperation(workspaceResolver, worktreeService, githubAuthService);
    this.fetchOp = new FetchOperation(workspaceResolver, githubAuthService);
    this.syncOp = new SyncOperation(workspaceResolver, worktreeService, githubAuthService);
    this.commitOp = new CommitOperation(workspaceResolver, worktreeService);
    this.discardOp = new DiscardOperation(workspaceResolver);
  }

  async cloneGitHubRepo(projectId: string, userContext: UserContext): Promise<{ warnings?: string[] }> {
    const key = `${userContext.organizationId}:${userContext.userId}:${projectId}`;
    const existing = this.inFlightClone.get(key);
    if (existing) return existing;

    const promise = this.cloneOp.execute(projectId, userContext)
      .finally(() => this.inFlightClone.delete(key));
    this.inFlightClone.set(key, promise);
    return promise;
  }

  async initializeGitHubRepo(projectId: string, userContext: UserContext, activeFeature?: string): Promise<{ warnings?: string[] }> {
    const key = `${userContext.organizationId}:${userContext.userId}:${projectId}`;
    const existing = this.inFlightInit.get(key);
    if (existing) return existing;

    const promise = this.initOp.execute(projectId, userContext, activeFeature)
      .finally(() => this.inFlightInit.delete(key));
    this.inFlightInit.set(key, promise);
    return promise;
  }

  async pushToGitHub(projectId: string, userContext: UserContext, featureName?: string): Promise<void> {
    return this.pushOp.execute(projectId, userContext, featureName);
  }

  async pullFromGitHub(projectId: string, userContext: UserContext, featureName?: string): Promise<void> {
    return this.pullOp.execute(projectId, userContext, featureName);
  }

  async fetchFromGitHub(projectId: string, userContext: UserContext, featureName?: string): Promise<void> {
    const key = `${userContext.organizationId}:${userContext.userId}:${projectId}:${featureName || 'main'}`;
    const existing = this.inFlightFetch.get(key);
    if (existing) {
      return existing;
    }

    const promise = this.fetchOp.execute(projectId, userContext, featureName)
      .finally(() => {
        this.inFlightFetch.delete(key);
      });

    this.inFlightFetch.set(key, promise);
    return promise;
  }

  async syncWithRemote(projectId: string, userContext: UserContext, featureName?: string): Promise<{
    success: boolean;
    pulledChanges?: boolean;
    pushedChanges?: boolean;
  }> {
    return this.syncOp.execute(projectId, userContext, featureName);
  }

  async commitChanges(
    projectId: string,
    userContext: UserContext,
    message?: string,
    featureName?: string,
    files?: string[]
  ): Promise<{ success: boolean; commitHash?: string }> {
    return this.commitOp.execute(projectId, userContext, message, featureName, files);
  }

  async discardChanges(
    projectId: string,
    userContext: UserContext,
    featureName?: string,
    files?: string[]
  ): Promise<{ success: boolean; discardedFiles: number }> {
    return this.discardOp.execute(projectId, userContext, featureName, files);
  }
}
