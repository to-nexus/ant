import type {
  GitSnapshot,
  GitPatState,
  GitUserOperation,
} from '@ant/shared';
import { WorkspaceResolver } from '../../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../../core/types/user';
import { GitHubAuthService } from '../../../auth/GitHubAuthService';
import { ChatService } from '../ChatService';
import { GitStateBroadcaster } from '../../../../../core/realtime/GitStateBroadcaster';
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
      broadcaster?: GitStateBroadcaster;
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
  // Clone status probe — retained for the Wizard's "clone has materialized"
  // polling helper at `GET /projects/:id/clone/status`.
  // =====================================

  async checkCloneStatus(projectId: string, userContext: UserContext): Promise<boolean> {
    return this.status.checkCloneStatus(projectId, userContext);
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
