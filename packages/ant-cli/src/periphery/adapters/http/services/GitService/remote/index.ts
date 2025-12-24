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

/**
 * RemoteService (Facade)
 * 
 * Main facade for Git remote operations.
 * Delegates to specific operation classes.
 */
export class RemoteService {
  private readonly cloneOp: CloneOperation;
  private readonly initOp: InitOperation;
  private readonly pushOp: PushOperation;
  private readonly pullOp: PullOperation;
  private readonly fetchOp: FetchOperation;
  private readonly syncOp: SyncOperation;
  private readonly commitOp: CommitOperation;

  constructor(
    workspaceResolver: WorkspaceResolver,
    githubAuthService?: GitHubAuthService,
    onIndexingTrigger?: (projectId: string, codebasePath: string, userContext: UserContext, feedbackFeature?: string) => void
  ) {
    this.cloneOp = new CloneOperation(workspaceResolver, githubAuthService);
    this.initOp = new InitOperation(workspaceResolver, githubAuthService, onIndexingTrigger);
    this.pushOp = new PushOperation(workspaceResolver, githubAuthService);
    this.pullOp = new PullOperation(workspaceResolver, githubAuthService);
    this.fetchOp = new FetchOperation(workspaceResolver, githubAuthService);
    this.syncOp = new SyncOperation(workspaceResolver, githubAuthService);
    this.commitOp = new CommitOperation(workspaceResolver);
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
  async pushToGitHub(projectId: string, userContext: UserContext): Promise<void> {
    return this.pushOp.execute(projectId, userContext);
  }

  /**
   * Pull from GitHub
   */
  async pullFromGitHub(projectId: string, userContext: UserContext): Promise<void> {
    return this.pullOp.execute(projectId, userContext);
  }

  /**
   * Fetch from GitHub
   */
  async fetchFromGitHub(projectId: string, userContext: UserContext): Promise<void> {
    return this.fetchOp.execute(projectId, userContext);
  }

  /**
   * Sync with GitHub (fetch + pull + push)
   */
  async syncWithRemote(projectId: string, userContext: UserContext): Promise<{
    success: boolean;
    pulledChanges?: boolean;
    pushedChanges?: boolean;
  }> {
    return this.syncOp.execute(projectId, userContext);
  }

  /**
   * Commit changes
   */
  async commitChanges(
    projectId: string,
    userContext: UserContext,
    message?: string
  ): Promise<{ success: boolean; commitHash?: string }> {
    return this.commitOp.execute(projectId, userContext, message);
  }
}

