/**
 * heavy-dealing-mural F3 — connections-refresh publish gating on finalize.
 *
 * The preview "service connections" panel showed a snapshot cached EARLY in the
 * job (before later seam/error tasks renamed app dirs / env vars), so the
 * Real/Virtualized toggle wrote an env var the final code no longer referenced
 * (no-op toggle). Fix: `finalizeTerminalJob` publishes `CONNECTIONS_REFRESH`
 * (fire-and-forget) so the ant-preview process re-detects from the FINAL code.
 *
 * This locks the GATING — the publish fires ONLY for a cleanly-completed `code`
 * job, never for failed / paused-interrupted / non-code jobs (which did not
 * change the scanned source the way a completed code job did).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { REDIS_KEYS } from '../../src/core/constants/redis';

let stateStoreStub: {
  acquireLock: ReturnType<typeof vi.fn>;
  updateJobStatus: ReturnType<typeof vi.fn>;
  getTaskQueue: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
};
let ledgerStub: { settle: ReturnType<typeof vi.fn>; releaseHold: ReturnType<typeof vi.fn> };

vi.mock('../../src/infrastructure/adapters/InfrastructureFactory', () => ({
  getInfrastructureFactory: () => ({
    getStateStore: () => stateStoreStub,
    getCreditLedger: () => ledgerStub,
  }),
}));

vi.mock('../../src/periphery/adapters/http/routes/helpers/sessionCleanup', () => ({
  sealJobRedisState: vi.fn(async () => {}),
}));

const mod = await import(
  '../../src/periphery/adapters/http/express/lifecycle/finalizeTerminalJob'
);
const { finalizeTerminalJob } = mod;

function makeDeps() {
  return {
    cleanupJobState: vi.fn(async () => {}),
    stateTracker: { cleanup: vi.fn(() => {}) } as any,
    kanbanService: {} as any,
  };
}

const USER = { organizationId: 'org-1', userId: 'user-1' } as any;

function refreshPublishCalls() {
  return stateStoreStub.publish.mock.calls.filter(
    (c) => c[0] === REDIS_KEYS.LIFECYCLE.CONNECTIONS_REFRESH,
  );
}

describe('finalizeTerminalJob — CONNECTIONS_REFRESH publish gating (heavy-dealing-mural F3)', () => {
  beforeEach(() => {
    stateStoreStub = {
      acquireLock: vi.fn(async () => true),
      updateJobStatus: vi.fn(async () => {}),
      getTaskQueue: vi.fn(async () => null),
      publish: vi.fn(async () => undefined),
    } as any;
    ledgerStub = { settle: vi.fn(async () => {}), releaseHold: vi.fn(async () => {}) };
  });

  afterEach(() => vi.clearAllMocks());

  it('completed + no interruption + code job → publishes refresh with org/user/project/feature', async () => {
    await finalizeTerminalJob(makeDeps(), {
      jobId: 'j1', finalStatus: 'completed', projectId: 'proj-1',
      featureName: 'main', jobType: 'code', userContext: USER,
    });
    const calls = refreshPublishCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({
      organizationId: 'org-1', userId: 'user-1', projectId: 'proj-1', feature: 'main',
    });
  });

  it('failed code job → no refresh', async () => {
    await finalizeTerminalJob(makeDeps(), {
      jobId: 'j2', finalStatus: 'failed', projectId: 'proj-1',
      featureName: 'main', jobType: 'code', userContext: USER,
    });
    expect(refreshPublishCalls()).toHaveLength(0);
  });

  it('completed code job WITH interruption (paused) → no refresh', async () => {
    await finalizeTerminalJob(makeDeps(), {
      jobId: 'j3', finalStatus: 'completed', projectId: 'proj-1',
      featureName: 'main', jobType: 'code', userContext: USER,
      interruption: { reason: 'system_sleep', message: 'x', timestamp: 't', canResume: true } as any,
    });
    expect(refreshPublishCalls()).toHaveLength(0);
  });

  it('completed non-code job (design) → no refresh', async () => {
    await finalizeTerminalJob(makeDeps(), {
      jobId: 'j4', finalStatus: 'completed', projectId: 'proj-1',
      featureName: 'main', jobType: 'design' as any, userContext: USER,
    });
    expect(refreshPublishCalls()).toHaveLength(0);
  });

  it('completed code job without userContext → no refresh (cannot key the cache)', async () => {
    await finalizeTerminalJob(makeDeps(), {
      jobId: 'j5', finalStatus: 'completed', projectId: 'proj-1',
      featureName: 'main', jobType: 'code',
    });
    expect(refreshPublishCalls()).toHaveLength(0);
  });
});
