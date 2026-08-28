/**
 * A failed git operation must STILL broadcast a fresh snapshot.
 *
 * Success-only broadcasting was one leg of the self-perpetuating commit
 * failure: the FE change list is pruned only when a new snapshot arrives, so
 * "fail → no snapshot → same stale paths → fail again" looped forever.
 */
import { describe, it, expect, vi } from 'vitest';
import { GitOperation, type GitOperationContext } from '../../src/periphery/adapters/http/services/GitService/remote/GitOperation';
import { GitConflictError } from '../../src/periphery/adapters/http/services/GitService/errors';
import type { GitUserOperation } from '@ant/shared';
import type { UserContext } from '../../src/core/types/user';

const userContext = { organizationId: 'local', userId: 'local' } as UserContext;
const snapshot = { staged: [], unstaged: [], untracked: [] };

function makeDeps() {
  return {
    statusService: {
      getSnapshot: vi.fn(async () => snapshot),
      getPat: vi.fn(async () => ({ configured: false })),
    },
    // Real GitStateBroadcaster signature — the assertions read `calls[0][3]`
    // (the GitOperationState), which a zero-arg `vi.fn` puts out of bounds.
    broadcaster: {
      notifyOperationComplete: vi.fn<
        (
          projectId: string,
          featureName: string | undefined,
          snapshot: unknown,
          operation: { status: string; error?: { message: string } },
          pat: unknown,
          userContext?: unknown,
        ) => Promise<void>
      >(async () => undefined),
    },
    watcher: { retryDeferredWatchers: vi.fn() },
  };
}

class FailingOp extends GitOperation<{ feature?: string }, void> {
  kind(): GitUserOperation {
    return { kind: 'commit' };
  }
  protected async run(_ctx: GitOperationContext<{ feature?: string }>): Promise<void> {
    throw new Error('pathspec kaboom');
  }
}

/** Throws the typed shape a classified operation produces. */
class ClassifiedFailureOp extends GitOperation<{ feature?: string }, void> {
  kind(): GitUserOperation {
    return { kind: 'push' };
  }
  protected async run(): Promise<void> {
    throw new GitConflictError('origin/main has 3 commit(s) this workspace does not have.', {
      retryable: false,
      suggestedAction: 'syncFirst',
      params: { branch: 'main', count: 3 },
    });
  }
}

class SucceedingOp extends GitOperation<{ feature?: string }, string> {
  kind(): GitUserOperation {
    return { kind: 'commit' };
  }
  protected async run(): Promise<string> {
    return 'ok';
  }
}

describe('GitOperation failure-path snapshot broadcast', () => {
  it('broadcasts a fresh snapshot with status=failed and rethrows', async () => {
    const deps = makeDeps();
    const op = new FailingOp(deps as never);

    await expect(op.execute('proj', userContext, { feature: 'feat' })).rejects.toThrow('pathspec kaboom');

    expect(deps.statusService.getSnapshot).toHaveBeenCalledWith('proj', userContext, 'feat');
    expect(deps.broadcaster.notifyOperationComplete).toHaveBeenCalledTimes(1);
    const operationArg = deps.broadcaster.notifyOperationComplete.mock.calls[0][3];
    expect(operationArg.status).toBe('failed');
    expect(operationArg.error?.message).toContain('pathspec kaboom');
    // Watcher retry / indexing stay success-only.
    expect(deps.watcher.retryDeferredWatchers).not.toHaveBeenCalled();
  });

  it('success path still broadcasts status=succeeded and re-arms watchers', async () => {
    const deps = makeDeps();
    const op = new SucceedingOp(deps as never);

    await expect(op.execute('proj', userContext, { feature: 'feat' })).resolves.toBe('ok');

    const operationArg = deps.broadcaster.notifyOperationComplete.mock.calls[0][3];
    expect(operationArg.status).toBe('succeeded');
    expect(deps.watcher.retryDeferredWatchers).toHaveBeenCalledWith('proj');
  });

  // Flattening every failure to `unknown` here left the SSE-delivered FSM
  // unable to offer the recovery the HTTP response already knew about — the
  // user saw raw git stderr and no next step.
  it('preserves the typed classification instead of flattening to unknown', async () => {
    const deps = makeDeps();
    const op = new ClassifiedFailureOp(deps as never);

    await expect(op.execute('proj', userContext, { feature: 'feat' })).rejects.toThrow(
      /does not have/,
    );

    const operationArg = deps.broadcaster.notifyOperationComplete.mock.calls[0][3] as {
      status: string;
      error?: Record<string, unknown>;
    };
    expect(operationArg.status).toBe('failed');
    expect(operationArg.error).toMatchObject({
      kind: 'conflict',
      retryable: false,
      suggestedAction: 'syncFirst',
      params: { branch: 'main', count: 3 },
    });
  });

  it('an untyped failure still falls back to the retryable unknown shape', async () => {
    const deps = makeDeps();
    const op = new FailingOp(deps as never);

    await expect(op.execute('proj', userContext, {})).rejects.toThrow('pathspec kaboom');

    const operationArg = deps.broadcaster.notifyOperationComplete.mock.calls[0][3] as {
      error?: Record<string, unknown>;
    };
    expect(operationArg.error).toMatchObject({ kind: 'unknown', retryable: true, suggestedAction: null });
  });

  it('a broadcaster hiccup on the failure path never masks the original error', async () => {
    const deps = makeDeps();
    deps.statusService.getSnapshot = vi.fn(async () => {
      throw new Error('status also broken');
    });
    const op = new FailingOp(deps as never);

    await expect(op.execute('proj', userContext, {})).rejects.toThrow('pathspec kaboom');
  });
});
