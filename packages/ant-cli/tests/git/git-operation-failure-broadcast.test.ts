/**
 * A failed git operation must STILL broadcast a fresh snapshot.
 *
 * Success-only broadcasting was one leg of the self-perpetuating commit
 * failure: the FE change list is pruned only when a new snapshot arrives, so
 * "fail → no snapshot → same stale paths → fail again" looped forever.
 */
import { describe, it, expect, vi } from 'vitest';
import { GitOperation, type GitOperationContext } from '../../src/periphery/adapters/http/services/GitService/remote/GitOperation';
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
    broadcaster: { notifyOperationComplete: vi.fn(async () => undefined) },
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
    expect(operationArg.error.message).toContain('pathspec kaboom');
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

  it('a broadcaster hiccup on the failure path never masks the original error', async () => {
    const deps = makeDeps();
    deps.statusService.getSnapshot = vi.fn(async () => {
      throw new Error('status also broken');
    });
    const op = new FailingOp(deps as never);

    await expect(op.execute('proj', userContext, {})).rejects.toThrow('pathspec kaboom');
  });
});
