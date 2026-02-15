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
import { PublishOperation } from './operations/PublishOperation';
import { WorktreeService } from '../worktree';

/**
 * RemoteService (Facade)
 * 
 * Main facade for Git remote operations.
 * Delegates to specific operation classes.
 */
export class RemoteService {
  // ✅ In-flight dedupe to prevent redundant concurrent fetches (e.g., multiple UI effects)
  private readonly inFlightFetch = new Map<string, Promise<void>>();

  private readonly cloneOp: CloneOperation;
  private readonly initOp: InitOperation;
  private readonly pushOp: PushOperation;
  private readonly pullOp: PullOperation;
  private readonly fetchOp: FetchOperation;
  private readonly syncOp: SyncOperation;
  private readonly commitOp: CommitOperation;
  private readonly publishOp: PublishOperation;

  constructor(
    workspaceResolver: WorkspaceResolver,
    githubAuthService?: GitHubAuthService,
    onIndexingTrigger?: (projectId: string, codebasePath: string, userContext: UserContext, feedbackFeature?: string) => void
  ) {
    const worktreeService = new WorktreeService(workspaceResolver, githubAuthService);

    this.cloneOp = new CloneOperation(workspaceResolver, githubAuthService);
    this.initOp = new InitOperation(workspaceResolver, githubAuthService, onIndexingTrigger);
    this.pushOp = new PushOperation(workspaceResolver, githubAuthService);
    this.pullOp = new PullOperation(workspaceResolver, githubAuthService);
    this.fetchOp = new FetchOperation(workspaceResolver, githubAuthService);
    this.syncOp = new SyncOperation(workspaceResolver, githubAuthService);
    this.commitOp = new CommitOperation(workspaceResolver);
    this.publishOp = new PublishOperation(workspaceResolver, worktreeService, githubAuthService, onIndexingTrigger);
  }

  /**
   * Clone GitHub repository
   */
  async cloneGitHubRepo(projectId: string, userContext: UserContext): Promise<void> {
    return this.cloneOp.execute(projectId, userContext);
  }

  /**
   * Initialize GitHub repository
   */
  async initializeGitHubRepo(projectId: string, userContext: UserContext): Promise<void> {
    return this.initOp.execute(projectId, userContext);
  }

  /**
   * Push to GitHub
   */
  async pushToGitHub(projectId: string, userContext: UserContext, featureName?: string): Promise<void> {
    return this.pushOp.execute(projectId, userContext, featureName);
  }

  /**
   * Pull from GitHub
   */
  async pullFromGitHub(projectId: string, userContext: UserContext, featureName?: string): Promise<void> {
    return this.pullOp.execute(projectId, userContext, featureName);
  }

  /**
   * Fetch from GitHub
   */
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

  /**
   * Sync with GitHub (fetch + pull + push)
   */
  async syncWithRemote(projectId: string, userContext: UserContext, featureName?: string): Promise<{
    success: boolean;
    pulledChanges?: boolean;
    pushedChanges?: boolean;
  }> {
    return this.syncOp.execute(projectId, userContext, featureName);
  }

  /**
   * Commit changes
   */
  async commitChanges(
    projectId: string,
    userContext: UserContext,
    message?: string,
    featureName?: string
  ): Promise<{ success: boolean; commitHash?: string }> {
    return this.commitOp.execute(projectId, userContext, message, featureName);
  }

  /**
   * Publish existing codebase to a new GitHub repository.
   * Unlike init, this allows features to already exist and creates branches for them.
   */
  async publishToGitHub(projectId: string, userContext: UserContext, activeFeature?: string): Promise<void> {
    return this.publishOp.execute(projectId, userContext, activeFeature);
  }
}

