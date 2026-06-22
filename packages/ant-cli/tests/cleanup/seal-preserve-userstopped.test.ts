/**
 * sealJobRedisState — userStopped flag preservation (Fix 3).
 *
 * The user_stopped finalize path must NOT clear the userStopped flag, so the
 * running child's stop watcher + the JobWorker poll + the pre-spawn guard stay
 * armed until the child is truly terminal. Every other seal (project/feature
 * delete, non-user-stop finalize) still clears it.
 */

import { describe, it, expect, vi } from 'vitest';
import { sealJobRedisState } from '../../src/periphery/adapters/http/routes/helpers/sessionCleanup';

function makeStateStore() {
  return {
    deleteJobStatus: vi.fn().mockResolvedValue(undefined),
    deleteTaskQueue: vi.fn().mockResolvedValue(undefined),
    deleteWorkflowState: vi.fn().mockResolvedValue(undefined),
    clearUserStopped: vi.fn().mockResolvedValue(undefined),
    deleteJobMapping: vi.fn().mockResolvedValue(undefined),
    deleteKillReason: vi.fn().mockResolvedValue(undefined),
  };
}

describe('sealJobRedisState — preserveUserStopped', () => {
  it('clears userStopped by default (deletion / non-user-stop seal)', async () => {
    const store = makeStateStore();
    await sealJobRedisState(store as any, undefined, 'job-1');
    expect(store.clearUserStopped).toHaveBeenCalledWith('job-1');
    // Other keys always sealed.
    expect(store.deleteJobStatus).toHaveBeenCalledWith('job-1');
    expect(store.deleteKillReason).toHaveBeenCalledWith('job-1');
  });

  it('preserves userStopped when preserveUserStopped=true', async () => {
    const store = makeStateStore();
    await sealJobRedisState(store as any, undefined, 'job-2', true);
    expect(store.clearUserStopped).not.toHaveBeenCalled();
    // The rest of the seal still runs.
    expect(store.deleteJobStatus).toHaveBeenCalledWith('job-2');
    expect(store.deleteTaskQueue).toHaveBeenCalledWith('job-2');
    expect(store.deleteKillReason).toHaveBeenCalledWith('job-2');
  });
});
