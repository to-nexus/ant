import type { GitCloneResult, GitInitResult, GitUserOperation } from '@ant/shared';
import { UserContext } from '../../../../../../../core/types/user';
import {
  GitOperation,
  GitOperationContext,
  GitOperationDeps,
} from '../GitOperation';
import { RemoteService } from '..';
import type { CommitResult } from './CommitOperation';

/**
 * User-facing Git operation classes. Each one is a thin wrapper that
 * delegates the actual git work to the existing {@link RemoteService}
 * primitives (battle-tested corner-case handling for Sync semantics,
 * Publish variants, lazy worktree creation, etc.) while inheriting the
 * symmetric `onSuccess` template-method from {@link GitOperation}.
 *
 * The composition strategy intentionally avoids re-implementing Publish's
 * four-variant polymorphism and Sync's six-step semantics: both live in
 * {@link RemoteService} where they are already exercised by production.
 */

interface FeatureInput {
  feature?: string;
}

interface CommitInput extends FeatureInput {
  message?: string;
  files?: string[];
  authorMode?: 'user' | 'ant';
}

interface DiscardInput extends FeatureInput {
  files?: string[];
}

/** `strategy` arrives unvalidated from the HTTP body — `pullArgs` narrows it. */
interface ReconcileInput extends FeatureInput {
  strategy?: unknown;
}

interface UserOpExtraDeps {
  remote: RemoteService;
}

type FullDeps = GitOperationDeps & UserOpExtraDeps;

/**
 * `publish` auto-resolves to one of four backend variants depending on the
 * state matrix (see docs §6.1). At the backend boundary we delegate to the
 * existing `initializeGitHubRepo` path which already covers S1/S2/S3, and
 * to `pushToGitHub` for the S4 branch-publish variant. The pre-check lets us
 * reject the "already on upstream" case with a conflict error.
 */
export class PublishOperation extends GitOperation<FeatureInput, Partial<GitInitResult>> {
  private readonly remote: RemoteService;
  constructor(deps: FullDeps) {
    super(deps);
    this.remote = deps.remote;
  }

  kind(): GitUserOperation {
    return { kind: 'publish' };
  }

  protected async run(ctx: GitOperationContext<FeatureInput>): Promise<Partial<GitInitResult>> {
    const { projectId, userContext, input } = ctx;
    const snapshot = await this.deps.statusService.getSnapshot(projectId, userContext, input?.feature);
    if (!snapshot.hasGit || !snapshot.hasRemote) {
      return this.remote.initializeGitHubRepo(projectId, userContext);
    }
    if (!snapshot.hasUpstream) {
      await this.remote.pushToGitHub(projectId, userContext, input?.feature);
      return {};
    }
    return {};
  }

  protected shouldIndex(ctx: GitOperationContext<FeatureInput>): boolean {
    return !ctx.input?.feature;
  }
}

export class PushOperation extends GitOperation<FeatureInput, void> {
  private readonly remote: RemoteService;
  constructor(deps: FullDeps) {
    super(deps);
    this.remote = deps.remote;
  }

  kind(): GitUserOperation {
    return { kind: 'push' };
  }

  protected async run(ctx: GitOperationContext<FeatureInput>): Promise<void> {
    await this.remote.pushToGitHub(ctx.projectId, ctx.userContext, ctx.input?.feature);
  }
}

export class PullOperation extends GitOperation<ReconcileInput, void> {
  private readonly remote: RemoteService;
  constructor(deps: FullDeps) {
    super(deps);
    this.remote = deps.remote;
  }

  kind(): GitUserOperation {
    return { kind: 'pull' };
  }

  protected async run(ctx: GitOperationContext<ReconcileInput>): Promise<void> {
    await this.remote.pullFromGitHub(
      ctx.projectId,
      ctx.userContext,
      ctx.input?.feature,
      ctx.input?.strategy,
    );
  }
}

export class FetchOperation extends GitOperation<FeatureInput, void> {
  private readonly remote: RemoteService;
  constructor(deps: FullDeps) {
    super(deps);
    this.remote = deps.remote;
  }

  kind(): GitUserOperation {
    return { kind: 'fetch' };
  }

  protected async run(ctx: GitOperationContext<FeatureInput>): Promise<void> {
    await this.remote.fetchFromGitHub(ctx.projectId, ctx.userContext, ctx.input?.feature);
  }
}

export class SyncOperation extends GitOperation<
  ReconcileInput,
  { success: boolean; pulledChanges?: boolean; pushedChanges?: boolean }
> {
  private readonly remote: RemoteService;
  constructor(deps: FullDeps) {
    super(deps);
    this.remote = deps.remote;
  }

  kind(): GitUserOperation {
    return { kind: 'sync' };
  }

  protected async run(
    ctx: GitOperationContext<ReconcileInput>,
  ): Promise<{ success: boolean; pulledChanges?: boolean; pushedChanges?: boolean }> {
    return this.remote.syncWithRemote(
      ctx.projectId,
      ctx.userContext,
      ctx.input?.feature,
      ctx.input?.strategy,
    );
  }
}

export class CommitOperation extends GitOperation<
  CommitInput,
  CommitResult
> {
  private readonly remote: RemoteService;
  constructor(deps: FullDeps) {
    super(deps);
    this.remote = deps.remote;
  }

  kind(): GitUserOperation {
    return { kind: 'commit' };
  }

  protected async run(
    ctx: GitOperationContext<CommitInput>,
  ): Promise<CommitResult> {
    return this.remote.commitChanges(
      ctx.projectId,
      ctx.userContext,
      ctx.input?.message,
      ctx.input?.feature,
      ctx.input?.files,
      ctx.input?.authorMode,
    );
  }
}

export class DiscardOperation extends GitOperation<
  DiscardInput,
  { success: boolean; discardedFiles: number }
> {
  private readonly remote: RemoteService;
  constructor(deps: FullDeps) {
    super(deps);
    this.remote = deps.remote;
  }

  kind(): GitUserOperation {
    return { kind: 'discard' };
  }

  protected async run(
    ctx: GitOperationContext<DiscardInput>,
  ): Promise<{ success: boolean; discardedFiles: number }> {
    return this.remote.discardChanges(
      ctx.projectId,
      ctx.userContext,
      ctx.input?.feature,
      ctx.input?.files,
    );
  }
}

export class CloneOperation extends GitOperation<Record<string, unknown>, GitCloneResult> {
  private readonly remote: RemoteService;
  constructor(deps: FullDeps) {
    super(deps);
    this.remote = deps.remote;
  }

  kind(): GitUserOperation {
    return { kind: 'clone' };
  }

  protected async run(
    ctx: GitOperationContext<Record<string, unknown>>,
  ): Promise<GitCloneResult> {
    return this.remote.cloneGitHubRepo(ctx.projectId, ctx.userContext);
  }

  protected shouldIndex(): boolean {
    return true;
  }
}

/**
 * Factory returning a fresh {@link GitOperation} subclass instance for a
 * given user-op kind. The route handler dispatches here; unknown kinds
 * trigger a 400 at the boundary.
 */
export function resolveGitOperation(
  deps: FullDeps,
  kind: GitUserOperation['kind'],
): GitOperation<any, any> | null {
  switch (kind) {
    case 'publish': return new PublishOperation(deps);
    case 'push':    return new PushOperation(deps);
    case 'pull':    return new PullOperation(deps);
    case 'fetch':   return new FetchOperation(deps);
    case 'sync':    return new SyncOperation(deps);
    case 'commit':  return new CommitOperation(deps);
    case 'discard': return new DiscardOperation(deps);
    case 'clone':   return new CloneOperation(deps);
    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
      return null;
    }
  }
}

export type {
  UserOpExtraDeps,
  FullDeps as ResolveGitOperationDeps,
};

// Re-export UserContext for convenience (routes depend on this indirectly).
export type { UserContext };
