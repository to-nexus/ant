import type {
  GitStatusResponse,
  GitChangesResponse,
  GitSnapshot,
  GitPatState,
  GitUserOperation,
} from '@ant/shared';
import { WorkspaceResolver } from '../../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../../core/types/user';
import { GitHubAuthService } from '../../../auth/GitHubAuthService';
import { ChatService } from '../ChatService';
import { GitChangeBroadcaster } from '../../../../../core/realtime/GitChangeBroadcaster';
import { StatusService } from './status';
import { RemoteService } from './remote';
import { IndexService } from './indexing';
import {
  GitOperation,
  GitWatcherRetryPort,
} from './remote/GitOperation';
import { resolveGitOperation } from './remote/operations/userOps';

/**
 * GitService (Facade)
 *
 * Main facade for all Git-related operations. Owns two layered APIs:
 *
 * ## Greenfield surface (target)
 *
 * - {@link GitService.getSnapshot} / {@link GitService.getPat} — read paths
 *   used by the `GET /projects/:id/git/state` endpoint and the SSE
 *   reconnect refill.
 * - {@link GitService.resolveOperation} — factory that returns a
 *   {@link GitOperation} instance for a given `GitUserOperation['kind']`.
 *   Routes dispatch into this single entry point instead of calling
 *   nine distinct operation endpoints.
 *
 * ## Legacy surface (retained during the migration window)
 *
 * The `getGitStatus` / `getGitChanges` / `cloneGitHubRepo` / etc. methods
 * are still reachable so existing routes keep compiling. Cutover removes
 * these together with the old `/projects/:id/{clone,initialize,push,...}`
 * endpoints.
 */
export class GitService {
  private readonly status: StatusService;
  private readonly remote: RemoteService;
  private readonly index: IndexService;
  private readonly workspaceResolver: WorkspaceResolver;
  private readonly githubAuthService?: GitHubAuthService;

  constructor(
    workspaceResolver: WorkspaceResolver,
    githubAuthService?: GitHubAuthService,
    chatService?: ChatService
  ) {
    this.workspaceResolver = workspaceResolver;
    this.githubAuthService = githubAuthService;
    this.status = new StatusService(workspaceResolver, githubAuthService);
    this.index = new IndexService(workspaceResolver, chatService);

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
  // Greenfield Read API
  // =====================================

  async getSnapshot(
    projectId: string,
    userContext: UserContext,
    featureName?: string,
    opts: { fresh?: boolean } = {},
  ): Promise<GitSnapshot> {
    return this.status.getSnapshot(projectId, userContext, featureName, opts);
  }

  async getPat(userContext: UserContext): Promise<GitPatState> {
    return this.status.getPat(userContext);
  }

  // =====================================
  // Greenfield Operation Dispatch
  // =====================================

  /**
   * Resolve a user-op kind to its {@link GitOperation} subclass instance.
   *
   * The returned operation's `execute(projectId, userContext, input)`
   * performs the work *and* fires the symmetric `onSuccess` hook
   * (snapshot publish + `retryDeferredWatchers` + optional indexing).
   *
   * Callers pass:
   * - `broadcaster` (optional) to enable `gitState` SSE publishes.
   * - `watcher`     (optional) to hook `retryDeferredWatchers` uniformly.
   */
  resolveOperation(
    kind: GitUserOperation['kind'],
    opts: {
      broadcaster?: GitChangeBroadcaster;
      watcher?: GitWatcherRetryPort;
    } = {},
  ): GitOperation<any, any> | null {
    return resolveGitOperation(
      {
        statusService: this.status,
        broadcaster: opts.broadcaster,
        watcher: opts.watcher,
        getCodebasePath: (userContext, projectId, featureName) =>
          this.workspaceResolver.getCodebasePath(userContext, projectId, featureName),
        indexer: (projectId, codebasePath, userContext, feedbackFeature) => {
          this.index.autoIndexCodebase(projectId, codebasePath, userContext, feedbackFeature)
            .catch((err: any) => {
              console.error('⚠️  [GitService] Background indexing failed:', err);
            });
        },
        remote: this.remote,
      },
      kind,
    );
  }

  // =====================================
  // Legacy Status Operations
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
  // Legacy Remote Operations
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

  // Hint for callers wishing to silence unused-field checks in composition.
  // Kept private-by-TS-convention via leading underscore.
  _authProbe(): boolean {
    return Boolean(this.githubAuthService);
  }
}
