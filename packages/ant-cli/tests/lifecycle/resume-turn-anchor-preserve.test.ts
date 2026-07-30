/**
 * Regression — RouteConfigurator.createExecuteJob preserves the Redis turnId
 * anchor across a same-jobId re-launch (slow-earning-heron `no turn anchor` RCA).
 *
 * `/resume`, `/continue`, and `proceed_without_spec` re-enqueue the SAME jobId
 * with no `seedTurnId`. `setJobStatus` is a full overwrite, so without carrying
 * the prior turnId forward it erased `JobStatusData.turnId` — the only
 * cross-pod-safe anchor the cancel/resume card resolves from — and a later
 * interruption silently dropped the card. The enqueue layer now reads and
 * preserves the prior turnId (an explicit seedTurnId still wins).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { JobPayload } from '../../src/core/ports/queue';
import type { JobStatusData } from '../../src/core/ports/stateStore';

// Spies carry their real port signatures: the assertions below read
// `calls[0][0]` / `calls[0][1]`, and an untyped `vi.fn(async () => {})` infers a
// zero-arg signature, making those indices out of bounds rather than unchecked.
const enqueue = vi.fn<(payload: JobPayload) => Promise<string>>(async () => 'job-1');
const setJobStatus = vi.fn<(jobId: string, status: JobStatusData) => Promise<void>>(async () => {});
const setJobMapping = vi.fn(async () => {});
const getJobStatus = vi.fn(async (_id: string) => null as any);

vi.mock('../../src/infrastructure/adapters/InfrastructureFactory', () => ({
  getInfrastructureFactory: () => ({
    getJobQueue: () => ({ enqueue }),
    getStateStore: () => ({ setJobStatus, setJobMapping, getJobStatus }),
  }),
}));

vi.mock('../../src/utils/humanId', () => ({
  generateHumanId: () => 'fresh-generated-id',
}));

import { RouteConfigurator } from '../../src/periphery/adapters/http/express/config/RouteConfigurator';

function makeExecuteJob() {
  const deps: any = {
    workspaceService: { createWorkspace: async () => ({ storagePath: '/ws/p' }) },
    workspaceResolver: { getPhysicalWorkspacesPath: () => '/ws' },
  };
  const stateTracker: any = { initializeJob: vi.fn() };
  const rc = new (RouteConfigurator as any)(
    /* config */ {},
    deps,
    stateTracker,
    /* jobManager */ {},
    /* workflowBridge */ {},
    /* cleanupJobState */ vi.fn(),
    /* watchSessionFile */ vi.fn(),
  );
  return (rc as any).createExecuteJob();
}

const baseParams = {
  jobType: 'code',
  project: 'p',
  feature: 'f',
  userContext: { userId: 'u', organizationId: 'o' },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createExecuteJob — turn anchor preservation on re-launch', () => {
  it('carries the prior Redis turnId forward when a same-jobId re-launch has no seedTurnId', async () => {
    getJobStatus.mockResolvedValueOnce({ jobId: 'slow-earning-heron', status: 'paused', turnId: 't-117b2e6f' });
    const executeJob = makeExecuteJob();

    await executeJob({ ...baseParams, jobId: 'slow-earning-heron', isResume: true });

    expect(getJobStatus).toHaveBeenCalledWith('slow-earning-heron');
    expect(enqueue.mock.calls[0][0]).toMatchObject({ jobId: 'slow-earning-heron', seedTurnId: 't-117b2e6f' });
    expect(setJobStatus.mock.calls[0][1]).toMatchObject({ turnId: 't-117b2e6f' });
  });

  it('does NOT wipe the anchor: setJobStatus always carries a turnId on re-launch of an anchored job', async () => {
    getJobStatus.mockResolvedValueOnce({ jobId: 'j', status: 'paused', turnId: 't-abc' });
    const executeJob = makeExecuteJob();

    await executeJob({ ...baseParams, jobId: 'j', isResume: true });

    expect(setJobStatus.mock.calls[0][1].turnId).toBe('t-abc');
  });

  it('an explicit seedTurnId wins and skips the prior-status read', async () => {
    const executeJob = makeExecuteJob();

    await executeJob({ ...baseParams, jobId: 'j', isResume: true, seedTurnId: 't-explicit' });

    expect(getJobStatus).not.toHaveBeenCalled();
    expect(enqueue.mock.calls[0][0]).toMatchObject({ seedTurnId: 't-explicit' });
    expect(setJobStatus.mock.calls[0][1]).toMatchObject({ turnId: 't-explicit' });
  });

  it('a fresh job (no jobId) does not consult prior status', async () => {
    const executeJob = makeExecuteJob();

    await executeJob({ ...baseParams, seedTurnId: 't-new' });

    expect(getJobStatus).not.toHaveBeenCalled();
    expect(enqueue.mock.calls[0][0]).toMatchObject({ jobId: 'fresh-generated-id', seedTurnId: 't-new' });
  });
});
