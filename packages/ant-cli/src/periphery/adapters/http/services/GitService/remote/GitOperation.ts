import type {
  GitOperationState,
  GitPatState,
  GitSnapshot,
  GitUserOperation,
  GitUserOperationKind,
} from '@ant/shared';
import { UserContext } from '../../../../../../core/types/user';
import { GitStateBroadcaster } from '../../../../../../core/realtime/GitStateBroadcaster';
import { StatusService } from '../status';

/**
 * Watcher retry port — decoupled from the concrete `GitWatcherService`
 * so tests can stub it and the `core/realtime` module graph stays acyclic.
 */
export interface GitWatcherRetryPort {
  retryDeferredWatchers(projectId: string): void;
}

/**
 * Indexing trigger port. Kept as an optional callback to mirror the
 * existing `RemoteService(...onIndexingTrigger)` signature and avoid a
 * circular import with `IndexService`.
 */
export type IndexingTriggerFn = (
  projectId: string,
  codebasePath: string,
  userContext: UserContext,
  feedbackFeature?: string,
) => void;

export interface GitOperationDeps {
  statusService: StatusService;
  broadcaster?: GitStateBroadcaster;
  watcher?: GitWatcherRetryPort;
  indexer?: IndexingTriggerFn;
  /**
   * Workspace resolver used when the subclass needs to trigger indexing
   * (needs the codebase path). Callers that don't use indexing can omit it.
   */
  getCodebasePath?: (
    userContext: UserContext,
    projectId: string,
    featureName?: string,
  ) => string;
}

export interface GitOperationContext<TIn> {
  projectId: string;
  userContext: UserContext;
  input: TIn;
}

/**
 * Abstract template-method base for user-initiated Git operations.
 *
 * ## The symmetry guarantee
 *
 * Subclasses only implement {@link GitOperation.run} (and
 * {@link GitOperation.kind}). The public {@link GitOperation.execute}
 * wraps each `run` with a single, unconditional `onSuccess` hook that:
 *
 *   1. Computes the canonical {@link GitSnapshot} via StatusService.
 *   2. Publishes the `gitState` SSE event (cause='operationComplete').
 *   3. Invokes `retryDeferredWatchers(projectId)` — previously only wired
 *      on clone/initialize; now every op gets the same treatment.
 *   4. Optionally triggers background codebase indexing (Publish V1/V3
 *      + Clone only; other ops skip via `shouldIndex`).
 *
 * Failure paths are explicit: no SSE push, no watcher retry, no indexing.
 * The route handler serializes the thrown {@link GitOperationError} into
 * the `{ success: false, error }` payload.
 */
export abstract class GitOperation<TIn, TOut> {
  constructor(protected readonly deps: GitOperationDeps) {}

  /** Canonical user-op kind + companion payload — mirrors the FE dispatch. */
  abstract kind(): GitUserOperation;

  /** Subclass contract — perform the actual git work. */
  protected abstract run(ctx: GitOperationContext<TIn>): Promise<TOut>;

  /** Override if indexing should fire on success (default: false). */
  protected shouldIndex(_ctx: GitOperationContext<TIn>): boolean {
    return false;
  }

  /** Override to pick the feature name carried in the SSE payload. */
  protected featureName(ctx: GitOperationContext<TIn>): string | undefined {
    const anyInput = ctx.input as unknown as { feature?: string } | undefined;
    return anyInput?.feature;
  }

  /** Override to pick which feature to index on success. */
  protected indexingFeature(ctx: GitOperationContext<TIn>): string | undefined {
    return this.featureName(ctx);
  }

  async execute(
    projectId: string,
    userContext: UserContext,
    input: TIn,
  ): Promise<TOut> {
    const ctx: GitOperationContext<TIn> = { projectId, userContext, input };
    const result = await this.run(ctx);
    await this.onSuccess(ctx);
    return result;
  }

  protected async onSuccess(ctx: GitOperationContext<TIn>): Promise<void> {
    const { projectId, userContext } = ctx;
    const feature = this.featureName(ctx);

    // Snapshot + PAT probe are decoupled from the publish attempt so a
    // StatusService failure never masquerades as an operation failure.
    let snapshot: GitSnapshot | null = null;
    let pat: GitPatState = { configured: false };
    try {
      snapshot = await this.deps.statusService.getSnapshot(projectId, userContext, feature);
    } catch (error: any) {
      console.warn('[GitOperation] onSuccess snapshot failed:', error?.message ?? error);
    }
    try {
      pat = await this.deps.statusService.getPat(userContext);
    } catch { /* tolerate */ }

    if (snapshot && this.deps.broadcaster) {
      const operation: GitOperationState = {
        status: 'succeeded',
        op: this.kind(),
        completedAt: Date.now(),
      };
      try {
        await this.deps.broadcaster.notifyOperationComplete(
          projectId,
          feature,
          snapshot,
          operation,
          pat,
          userContext,
        );
      } catch (error: any) {
        console.warn('[GitOperation] broadcaster failed:', error?.message ?? error);
      }
    }

    // Previously only Clone/Initialize called this hook — the asymmetry was
    // the root cause of deferred watchers never being re-armed on Push/Pull/
    // Commit/Discard. See §5.2 of docs/architecture/24-git-operations.md.
    try {
      this.deps.watcher?.retryDeferredWatchers(projectId);
    } catch (error: any) {
      console.warn('[GitOperation] retryDeferredWatchers failed:', error?.message ?? error);
    }

    if (this.deps.indexer && this.shouldIndex(ctx)) {
      const codebasePath = this.deps.getCodebasePath?.(userContext, projectId);
      if (codebasePath) {
        try {
          this.deps.indexer(projectId, codebasePath, userContext, this.indexingFeature(ctx));
        } catch (error: any) {
          console.warn('[GitOperation] indexer trigger failed:', error?.message ?? error);
        }
      }
    }
  }
}

/**
 * Operation kinds map-to-class table. Kept as a type-level contract so
 * new op kinds force a new class entry, and the `resolveOperation`
 * factory guarantees every FE dispatch has a BE mapping.
 */
export type GitOperationFactoryMap = Readonly<
  Record<GitUserOperationKind, () => GitOperation<any, any>>
>;
