/**
 * Regression — `POST /jobs/:jobId/stop` MUST poison the job
 * (`ant:job-poisoned:{jobId}`) BEFORE publishing the STOP signal.
 *
 * Bug (job `sharded-wand`): stopped tasks stayed stuck in the Kanban
 * "In Progress" column and survived a page refresh. Root cause — the
 * user-stop path set `markUserStopped` + published STOP + finalized, but
 * (unlike the stalled/crash path: JobWorker / BullMQJobQueue) it never set
 * the poison flag. The poison flag is what gates the child's `onCheckpoint`
 * (code/graph.ts, design/session/checkpoint.ts) from writing a late session
 * checkpoint during the SIGTERM grace. Without it, the child's checkpoint
 * could land AFTER the API-server's `cleanupJobState` projection and
 * resurrect un-interrupted `runningTasks` on disk → rendered as live
 * in-progress on the next read.
 *
 * The fix sets the poison lock right after `markUserStopped`, BEFORE the
 * STOP publish, so the flag is guaranteed present before the worker can act
 * on the signal and the child runs `handleInterruption → onCheckpoint`.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'node:http';
import express from 'express';

vi.mock('../../src/periphery/adapters/http/middleware/rateLimiter', () => ({
  chatRateLimiter: (_req: any, _res: any, next: any) => next(),
  jobExecuteRateLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../src/periphery/adapters/http/routes/helpers/userContext', () => ({
  extractUserContext: () => ({ userId: 'u1', organizationId: 'o1' }),
}));

// finalize() is exercised separately (finalizeTerminalJob own tests); here
// we only assert the stop handler's poison-before-publish ordering, so the
// terminal pipeline is a no-op.
vi.mock('../../src/periphery/adapters/http/express/lifecycle/finalizeTerminalJob', () => ({
  finalizeTerminalJob: vi.fn(async () => {}),
}));

import { createJobRoutes } from '../../src/periphery/adapters/http/routes/job.routes';

// Records the order of the two Redis calls we care about.
const callOrder: string[] = [];

const fakeDeps: any = {
  workspaceResolver: { getFeaturePath: (_uc: any, _p: string, f: string) => `/tmp/ws/${f}` },
  executeJob: vi.fn(),
  cleanupJobState: vi.fn(async () => {}),
  workflowStateService: {},
  chatService: { appendAssistantMessage: vi.fn() },
  stateStore: {
    markUserStopped: vi.fn(async () => { callOrder.push('markUserStopped'); }),
    acquireLock: vi.fn(async (key: string) => { callOrder.push(`acquireLock:${key}`); return true; }),
    publish: vi.fn(async () => { callOrder.push('publish'); }),
    getJobStatus: async () => null,
  },
  stateTracker: { activeJobs: new Map() },
};

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(createJobRoutes(fakeDeps));
  await new Promise<void>(resolve => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  if (addr && typeof addr === 'object') baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

beforeEach(() => {
  callOrder.length = 0;
  vi.clearAllMocks();
});

async function postStop(jobId: string) {
  const res = await fetch(`${baseUrl}/jobs/${jobId}/stop`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: 'p1', featureName: 'f1', jobType: 'code' }),
  });
  return res;
}

describe('POST /jobs/:jobId/stop — poison flag (sharded-wand regression)', () => {
  it('sets the poison lock with the canonical key', async () => {
    const res = await postStop('job-xyz');
    expect(res.status).toBe(200);
    expect(fakeDeps.stateStore.acquireLock).toHaveBeenCalledWith('ant:job-poisoned:job-xyz', 600);
  });

  it('poisons BEFORE publishing the STOP signal', async () => {
    await postStop('job-abc');
    const poisonIdx = callOrder.indexOf('acquireLock:ant:job-poisoned:job-abc');
    const publishIdx = callOrder.indexOf('publish');
    expect(poisonIdx).toBeGreaterThanOrEqual(0);
    expect(publishIdx).toBeGreaterThanOrEqual(0);
    expect(poisonIdx).toBeLessThan(publishIdx);
  });
});
