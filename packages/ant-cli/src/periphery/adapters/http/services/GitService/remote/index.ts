import { WorkspaceResolver } from '../../../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../../../core/types/user';
import { GitHubAuthService } from '../../../../auth/GitHubAuthService';
import type { StateStorePort } from '../../../../../../core/ports/stateStore';
import { CloneOperation } from './operations/CloneOperation';
import { InitOperation } from './operations/InitOperation';
import { PushOperation } from './operations/PushOperation';
import { PullOperation } from './operations/PullOperation';
import { FetchOperation } from './operations/FetchOperation';
import { SyncOperation } from './operations/SyncOperation';
import { CommitOperation } from './operations/CommitOperation';
import { DiscardOperation } from './operations/DiscardOperation';
import { WorktreeService } from '../worktree';
import { acquireLock } from '../../../../../../core/redis/distributedLock';
import { REDIS_KEYS } from '../../../../../../core/constants/redis';
import { GitConflictError } from '../errors';

const LOCK_TTL_CLONE_SEC = 600; // clone is the longest single-flight (full bare clone + flatten)
// Aligned with the FE Promise.race timeout for `publish` (120s) so the lock
// never outlives the user-visible failure window — InitOperation hangs are
// already capped by simple-git block timeout (60s) and GitHub fetch/octokit
// timeouts (30s), so the work itself completes or throws well before this.
const LOCK_TTL_INIT_SEC = 120;
const LOCK_TTL_FETCH_SEC = 180;

/**
 * RemoteService (Facade)
 *
 * Single-flight clone / init / fetch is enforced via a Redis distributed
 * lock (`tryAcquireLock` / `releaseLockIfOwner`) — works across pod
 * replicas, unlike the old in-process Map. Per the parent plan's
 * "Unified Distributed System Principle", in-memory mirrors of Redis
 * SSOT state are forbidden; if `stateStore` is missing the wrapper
 * throws (dev parity is guaranteed by `pnpm dev:infra`).
 */
export class RemoteService {
  private readonly stateStore?: StateStorePort;

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
    onIndexingTrigger?: (projectId: string, codebasePath: string, userContext: UserContext, feedbackFeature?: string) => void,
    stateStore?: StateStorePort,
  ) {
    this.stateStore = stateStore;
    const worktreeService = new WorktreeService(workspaceResolver, githubAuthService);

    this.cloneOp = new CloneOperation(workspaceResolver, worktreeService, githubAuthService);
    this.initOp = new InitOperation(workspaceResolver, worktreeService, githubAuthService, onIndexingTrigger);
    this.pushOp = new PushOperation(workspaceResolver, worktreeService, githubAuthService);
    this.pullOp = new PullOperation(workspaceResolver, worktreeService, githubAuthService);
    this.fetchOp = new FetchOperation(workspaceResolver, worktreeService, githubAuthService);
    this.syncOp = new SyncOperation(workspaceResolver, worktreeService, githubAuthService);
    this.commitOp = new CommitOperation(workspaceResolver, worktreeService);
    this.discardOp = new DiscardOperation(workspaceResolver, worktreeService);
  }

  /**
   * SSOT wrapper for distributed single-flight. Used by clone / init /
   * fetch — each provides its own lock key, TTL, and conflict message.
   *
   * Contention behavior: throws `GitConflictError` (HTTP 409) so the
   * caller can decide to display "another op in progress, retry later"
   * rather than queueing. Queueing on top of HTTP would inflate timeout
   * windows beyond what the wizard / git menu expects.
   */
  private async withLock<T>(
    key: string,
    ttlSec: number,
    conflictMessage: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (!this.stateStore) {
      throw new Error(
        `[RemoteService] stateStore not injected — distributed lock unavailable. ` +
          `Ensure ServiceInitializer wires stateStore (cloud + local dev both require it).`,
      );
    }
    const lock = await acquireLock(this.stateStore, key, ttlSec);
    if (!lock) {
      // Lock contention is a transient "another op is running" state, not the
      // permanent merge-conflict / already-exists case — flag it retryable
      // and surface the TTL so the UI can countdown until the next attempt.
      throw new GitConflictError(conflictMessage, {
        retryable: true,
        retryAfterMs: ttlSec * 1000,
      });
    }
    try {
      return await fn();
    } finally {
      await lock.release();
    }
  }

  async cloneGitHubRepo(projectId: string, userContext: UserContext): Promise<{ warnings?: string[] }> {
    return this.withLock(
      REDIS_KEYS.LOCK.CLONE(userContext.organizationId, userContext.userId, projectId),
      LOCK_TTL_CLONE_SEC,
      'Another clone is in progress for this project. Please wait and retry.',
      () => this.cloneOp.execute(projectId, userContext),
    );
  }

  async initializeGitHubRepo(projectId: string, userContext: UserContext, activeFeature?: string): Promise<{ warnings?: string[] }> {
    return this.withLock(
      REDIS_KEYS.LOCK.INIT(userContext.organizationId, userContext.userId, projectId),
      LOCK_TTL_INIT_SEC,
      'Another init is in progress for this project. Please wait and retry.',
      () => this.initOp.execute(projectId, userContext, activeFeature),
    );
  }

  async pushToGitHub(projectId: string, userContext: UserContext, featureName?: string): Promise<void> {
    return this.pushOp.execute(projectId, userContext, featureName);
  }

  async pullFromGitHub(projectId: string, userContext: UserContext, featureName?: string): Promise<void> {
    return this.pullOp.execute(projectId, userContext, featureName);
  }

  async fetchFromGitHub(projectId: string, userContext: UserContext, featureName?: string): Promise<void> {
    return this.withLock(
      REDIS_KEYS.LOCK.FETCH(userContext.organizationId, userContext.userId, projectId, featureName || 'main'),
      LOCK_TTL_FETCH_SEC,
      'Another fetch is in progress for this project / feature. Please wait and retry.',
      () => this.fetchOp.execute(projectId, userContext, featureName),
    );
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
