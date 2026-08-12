/**
 * Dismiss/continue/resume route branches — the consent-marker consistency
 * axis (icy-landing-glade RCA):
 *  - /job/dismiss paused branch preserves the ORIGINAL interruption identity
 *    (reason/timestamp) and only arms `dismissed` (a minted fresh timestamp
 *    defeated the FE localStorage compare and erased the real cause).
 *  - /job/dismiss terminal-Redis branch arms the marker + folds the card
 *    (previously left the queue armed and the card dangling).
 *  - /continue clears the marker (explicit consent, mirrors /resume).
 *  - /resume falls back to the superseded-state archive when a later job
 *    took over the live session slot.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'node:http';
import express from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('../../src/periphery/adapters/http/middleware/rateLimiter', () => ({
  chatRateLimiter: (_req: any, _res: any, next: any) => next(),
  jobExecuteRateLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../src/periphery/adapters/http/routes/helpers/userContext', () => ({
  extractUserContext: () => ({ userId: 'u1', organizationId: 'o1' }),
  isLocalServerMode: () => true,
}));

vi.mock('../../src/periphery/adapters/http/routes/helpers/jobAccess', () => ({
  assertJobAccess: vi.fn(async () => null),
}));

vi.mock('../../src/periphery/adapters/http/routes/helpers/approvalGate', () => ({
  checkApproval: vi.fn(async () => null),
  approvalErrorCode: () => 'X',
}));

vi.mock('../../src/periphery/adapters/http/express/lifecycle/finalizeTerminalJob', () => ({
  finalizeTerminalJob: vi.fn(async () => {}),
}));

import { createJobRoutes } from '../../src/periphery/adapters/http/routes/job.routes';
import { finalizeTerminalJob } from '../../src/periphery/adapters/http/express/lifecycle/finalizeTerminalJob';
import { archiveSupersededState } from '../../src/core/session/archive';

let featurePath: string;
let jobStatus: any = null;

const fakeDeps: any = {
  workspaceResolver: {
    getFeaturePath: () => featurePath,
    getProjectPath: () => path.dirname(featurePath),
  },
  executeJob: vi.fn(async (params: any) => ({ jobId: params.jobId })),
  cleanupJobState: vi.fn(async () => {}),
  workflowStateService: {},
  chatService: {
    resolveAllCancelledForJob: vi.fn(async () => 1),
    appendAssistantMessage: vi.fn(async () => {}),
  },
  stateStore: {
    getJobStatus: vi.fn(async () => jobStatus),
    releaseLock: vi.fn(async () => {}),
    acquireLock: vi.fn(async () => true),
    publish: vi.fn(async () => {}),
    markUserStopped: vi.fn(async () => {}),
    listJobsByFeature: vi.fn(async () => []),
  },
  stateTracker: { activeJobs: new Map() },
};

let server: http.Server;
let baseUrl: string;

function writeCodeSession(state: Record<string, any>) {
  const dir = path.join(featurePath, 'sessions', 'architect');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'code.json'), JSON.stringify({ runs: [], state }, null, 2));
}

function readCodeSession(): any {
  return JSON.parse(fs.readFileSync(path.join(featurePath, 'sessions', 'architect', 'code.json'), 'utf-8'));
}

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
  vi.clearAllMocks();
  jobStatus = null;
  featurePath = fs.mkdtempSync(path.join(os.tmpdir(), 'dismiss-route-'));
});

async function post(route: string, body: Record<string, unknown>) {
  return fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const interruption = (over: Record<string, any> = {}) => ({
  reason: 'api_error',
  message: 'Upstream failed',
  timestamp: '2026-08-11T18:14:42.000Z',
  canResume: true,
  ...over,
});

describe('POST /job/dismiss — branch × marker matrix', () => {
  it('paused branch preserves the original interruption identity, arming only dismissed', async () => {
    jobStatus = { status: 'paused', type: 'code' };
    writeCodeSession({ jobId: 'j1', taskQueue: [{ id: 't1' }], interruption: interruption() });

    const res = await post('/projects/p1/features/f1/job/dismiss', { jobId: 'j1' });
    expect(res.status).toBe(200);

    const finalizeArgs = (finalizeTerminalJob as any).mock.calls[0][1];
    expect(finalizeArgs.interruption.reason).toBe('api_error');
    expect(finalizeArgs.interruption.timestamp).toBe('2026-08-11T18:14:42.000Z');
    expect(finalizeArgs.interruption.canResume).toBe(true);
    expect(finalizeArgs.interruption.dismissed).toBe(true);
    expect(finalizeArgs.interruption.metadata?.stoppedBy).toBe('dismiss');
    expect(fakeDeps.chatService.resolveAllCancelledForJob).toHaveBeenCalledWith(
      'p1', 'f1', 'j1', expect.objectContaining({ choiceSelected: 'dismiss' }),
    );
  });

  it('paused branch without a persisted interruption falls back to the user_stopped literal', async () => {
    jobStatus = { status: 'paused', type: 'code' };
    writeCodeSession({ jobId: 'j1', taskQueue: [{ id: 't1' }] });

    await post('/projects/p1/features/f1/job/dismiss', { jobId: 'j1' });
    const finalizeArgs = (finalizeTerminalJob as any).mock.calls[0][1];
    expect(finalizeArgs.interruption.reason).toBe('user_stopped');
    expect(finalizeArgs.interruption.dismissed).toBe(true);
  });

  it('terminal-Redis branch arms the session marker AND folds the cancelled cards', async () => {
    jobStatus = { status: 'failed', type: 'code' };
    writeCodeSession({ jobId: 'j1', taskQueue: [{ id: 't1' }], interruption: interruption() });

    const res = await post('/projects/p1/features/f1/job/dismiss', { jobId: 'j1' });
    expect(res.status).toBe(200);
    expect(readCodeSession().state.interruption.dismissed).toBe(true);
    expect(fakeDeps.chatService.resolveAllCancelledForJob).toHaveBeenCalledWith(
      'p1', 'f1', 'j1', expect.objectContaining({ choiceSelected: 'dismiss' }),
    );
  });

  it('sealed branch (no Redis record) patches the session marker', async () => {
    jobStatus = null;
    writeCodeSession({ jobId: 'j1', taskQueue: [{ id: 't1' }], interruption: interruption() });

    const res = await post('/projects/p1/features/f1/job/dismiss', { jobId: 'j1' });
    expect(res.status).toBe(200);
    const session = readCodeSession();
    expect(session.state.interruption.dismissed).toBe(true);
    expect(session.state.interruption.timestamp).toBe('2026-08-11T18:14:42.000Z');
  });
});

describe('POST /jobs/:jobId/continue — explicit consent clears the marker', () => {
  it('clears dismissed and resumes with isResume:true', async () => {
    writeCodeSession({
      jobId: 'j1',
      taskQueue: [{ id: 't1' }],
      interruption: interruption({ dismissed: true }),
    });

    const res = await post('/jobs/j1/continue', {
      projectId: 'p1', featureName: 'f1', newDirective: 'keep going',
    });
    expect(res.status).toBe(200);
    expect(readCodeSession().state.interruption.dismissed).toBe(false);
    expect(fakeDeps.executeJob).toHaveBeenCalledWith(expect.objectContaining({ isResume: true, jobId: 'j1' }));
  });
});

describe('POST /jobs/:jobId/resume — archive fallback (icy-landing-glade)', () => {
  it('restores the superseded state from the archive when the live slot moved on', async () => {
    // A later job took over the live slot; the interrupted job survives only
    // in the archive that the runner fresh-takeover branch wrote.
    await archiveSupersededState(featurePath, 'architect', 'code', {
      jobId: 'old-job',
      taskQueue: [{ id: 't1', name: 'T' }],
      interruption: interruption({ dismissed: true }),
    } as any);
    writeCodeSession({ jobId: 'new-job', taskQueue: [], completedTasks: ['x'] });

    const res = await post('/jobs/old-job/resume', { projectId: 'p1', featureName: 'f1' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.jobId).toBe('old-job');

    const session = readCodeSession();
    expect(session.state.jobId).toBe('old-job');
    // Explicit resume clears the dismissed marker on the restored state.
    expect(session.state.interruption.dismissed).toBe(false);
    expect(fakeDeps.executeJob).toHaveBeenCalledWith(expect.objectContaining({ isResume: true, jobId: 'old-job' }));
  });

  it('still 404s when neither the live slot nor the archive knows the jobId', async () => {
    writeCodeSession({ jobId: 'new-job', taskQueue: [], completedTasks: ['x'] });
    const res = await post('/jobs/ghost/resume', { projectId: 'p1', featureName: 'f1' });
    expect(res.status).toBe(404);
  });
});
