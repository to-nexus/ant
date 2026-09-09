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
 *
 * Second axis (universal resume): WHO answers "which definition ref, which
 * job id" and what a refusal looks like. The client used to answer the first
 * question — with the composer's current selection, which is not the paused
 * pair — and three of four call sites did not answer it at all, so the route
 * fell through to the canonical scan and refused 400. Rows here pin: the ref
 * is recovered server-side (mapping, then the on-disk scan), the resume
 * targets the REQUESTED job rather than the previous run's sealed id, a held
 * lock is a typed retryable 409, and the cancelled card is folded only AFTER
 * the dispatch actually started.
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
  checkTeamMembership: vi.fn(async () => true),
}));

vi.mock('../../src/periphery/adapters/http/express/lifecycle/finalizeTerminalJob', () => ({
  finalizeTerminalJob: vi.fn(async () => {}),
}));

// Only the DEFINITION loader is stubbed — `resolveUniversalResumeTarget` stays
// real, because the ref-recovery order is exactly what these rows pin.
vi.mock('../../src/core/scheduling/UniversalDispatchGate', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    resolveUniversalExecuteContext: vi.fn(async (_r: any, _u: any, _p: any, ref: any) => ({
      ok: true,
      containerPath: universalContainerPath,
      ref: { agentId: String(ref).split('/')[0], jobId: String(ref).split('/')[1] },
      intentIds: new Set<string>(),
      declaresSelfApi: false,
      builtinTools: [],
      scopeRoots: [],
      pipelineScopeRoots: [],
    })),
    validateUniversalTurnMeta: vi.fn(async () => ({ ok: true, meta: null })),
  };
});

vi.mock('../../src/infrastructure/adapters/InfrastructureFactory', () => ({
  getInfrastructureFactory: () => ({
    getJobQueue: () => ({ isJobLockFresh: async () => lockFresh }),
    getCreditLedger: () => ({ getBalance: async () => ({ credits: 1e9 }) }),
  }),
}));

import { createJobRoutes } from '../../src/periphery/adapters/http/routes/job.routes';
import { assertJobAccess } from '../../src/periphery/adapters/http/routes/helpers/jobAccess';
import { finalizeTerminalJob } from '../../src/periphery/adapters/http/express/lifecycle/finalizeTerminalJob';
import { archiveSupersededState } from '../../src/core/session/archive';

let featurePath: string;
let jobStatus: any = null;
let jobMapping: any = null;
let lockFresh = false;
/** The enclosing project dir. Must be per-test: the universal plane hangs off
 *  it, and deriving it from `dirname(featurePath)` put it in the shared
 *  os.tmpdir(), so one test's session file leaked into the next one's scan. */
let projectPath = '';
let universalContainerPath = '';

const fakeDeps: any = {
  workspaceResolver: {
    getFeaturePath: () => featurePath,
    getProjectPath: () => projectPath,
    getUniversalContainerPath: () => universalContainerPath,
  },
  executeJob: vi.fn(async (params: any) => ({ jobId: params.jobId })),
  cleanupJobState: vi.fn(async () => {}),
  workflowStateService: {},
  chatService: {
    resolveAllCancelledForJob: vi.fn(async () => 1),
    appendAssistantMessage: vi.fn(async () => {}),
    findInterruptedTurn: vi.fn(async () => ({ turnId: 'turn-orig', text: 'the interrupted instruction' })),
  },
  stateStore: {
    getJobStatus: vi.fn(async () => jobStatus),
    getJobMapping: vi.fn(async () => jobMapping),
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
  jobMapping = null;
  lockFresh = false;
  projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'dismiss-route-'));
  featurePath = path.join(projectPath, 'features', 'f1');
  fs.mkdirSync(featurePath, { recursive: true });
  universalContainerPath = path.join(projectPath, 'universal');
});

/** Make the enclosing project a workspace (universal) project on disk. */
function makeUniversalProject() {
  fs.writeFileSync(path.join(projectPath, 'config.json'), JSON.stringify({ projectType: 'universal' }));
}

/** A sealed universal session for `{agentId}/{customJobId}`. */
function writeUniversalSession(agentId: string, customJobId: string, state: Record<string, any>) {
  const dir = path.join(universalContainerPath, 'sessions', agentId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${customJobId}.json`), JSON.stringify({ runs: [], state }, null, 2));
}

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

  it('a foreign job is refused before finalize runs (M-017)', async () => {
    // The owner gate is unit-tested in policy/tenant-scoping.test.ts; this row
    // pins that the dismiss handler consults it at all — it was the one
    // jobId-addressed handler that never called it.
    jobStatus = { status: 'paused', type: 'code' };
    writeCodeSession({ jobId: 'j1', taskQueue: [{ id: 't1' }], interruption: interruption() });
    (assertJobAccess as any).mockResolvedValueOnce({ code: 403, body: { error: 'Forbidden' } });

    const res = await post('/projects/p1/features/f1/job/dismiss', { jobId: 'j1' });
    expect(res.status).toBe(403);
    expect(finalizeTerminalJob).not.toHaveBeenCalled();
    expect(fakeDeps.chatService.resolveAllCancelledForJob).not.toHaveBeenCalled();
    expect(readCodeSession().state.interruption.dismissed).toBeUndefined();
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

describe('POST /jobs/:jobId/resume — universal: the server owns the resume target', () => {
  it('routes by project type and recovers the ref from the job mapping — no ref in the body', async () => {
    makeUniversalProject();
    jobMapping = { customJobRef: 'agent-builder/author' };
    writeUniversalSession('agent-builder', 'author', { jobId: 'previous-run' });

    const res = await post('/jobs/crashed-run/resume', { projectId: 'p1', featureName: 'universal' });
    expect(res.status).toBe(200);
    expect(fakeDeps.executeJob).toHaveBeenCalledWith(expect.objectContaining({
      jobType: 'universal',
      customJobRef: 'agent-builder/author',
      isResume: true,
    }));
  });

  it('falls back to the on-disk session scan when the mapping has expired', async () => {
    makeUniversalProject();
    jobMapping = null; // 24h TTL lapsed
    writeUniversalSession('agent-builder', 'author', { jobId: 'crashed-run' });

    const res = await post('/jobs/crashed-run/resume', { projectId: 'p1', featureName: 'universal' });
    expect(res.status).toBe(200);
    expect(fakeDeps.executeJob).toHaveBeenCalledWith(expect.objectContaining({
      customJobRef: 'agent-builder/author',
    }));
  });

  it('resumes the REQUESTED job, not the previous run sealed in state.jobId', async () => {
    // `state.jobId` is written by the end-of-turn seal, so after a crash it
    // names the run BEFORE the interrupted one. Resuming under it re-queued an
    // already-sealed id and left the crashed job paused forever.
    makeUniversalProject();
    jobMapping = { customJobRef: 'agent-builder/author' };
    writeUniversalSession('agent-builder', 'author', { jobId: 'previous-run' });

    const res = await post('/jobs/crashed-run/resume', { projectId: 'p1', featureName: 'universal' });
    expect(res.status).toBe(200);
    expect((await res.json() as any).jobId).toBe('crashed-run');
    expect(fakeDeps.executeJob).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'crashed-run' }));
  });

  it('re-dispatches the interrupted instruction under its original turn anchor', async () => {
    makeUniversalProject();
    jobMapping = { customJobRef: 'agent-builder/author' };
    writeUniversalSession('agent-builder', 'author', { jobId: 'crashed-run' });

    await post('/jobs/crashed-run/resume', { projectId: 'p1', featureName: 'universal' });
    expect(fakeDeps.executeJob).toHaveBeenCalledWith(expect.objectContaining({
      overrideDirective: 'the interrupted instruction',
      seedTurnId: 'turn-orig',
    }));
  });

  it('resumes a FIRST-turn crash that sealed no session at all', async () => {
    // The old branch required the session file to exist, so a job killed
    // before its first seal was permanently unresumable.
    makeUniversalProject();
    jobMapping = { customJobRef: 'agent-builder/author' };

    const res = await post('/jobs/crashed-run/resume', { projectId: 'p1', featureName: 'universal' });
    expect(res.status).toBe(200);
    expect(fakeDeps.executeJob).toHaveBeenCalledWith(expect.objectContaining({
      overrideDirective: 'the interrupted instruction',
    }));
  });

  it('folds the cancelled card only AFTER the dispatch started', async () => {
    makeUniversalProject();
    jobMapping = { customJobRef: 'agent-builder/author' };
    writeUniversalSession('agent-builder', 'author', { jobId: 'crashed-run' });

    await post('/jobs/crashed-run/resume', { projectId: 'p1', featureName: 'universal' });
    expect(fakeDeps.chatService.resolveAllCancelledForJob).toHaveBeenCalledWith(
      'p1', 'universal', 'crashed-run', expect.objectContaining({ choiceSelected: 'resume' }),
    );
  });
});

describe('POST /jobs/:jobId/resume — refusals are typed, never silent', () => {
  it('409 job-lock-active while a worker still holds the lock, before any side effect', async () => {
    makeUniversalProject();
    jobMapping = { customJobRef: 'agent-builder/author' };
    lockFresh = true;

    const res = await post('/jobs/crashed-run/resume', { projectId: 'p1', featureName: 'universal' });
    expect(res.status).toBe(409);
    expect((await res.json() as any).code).toBe('job-lock-active');
    expect(fakeDeps.executeJob).not.toHaveBeenCalled();
    // The "Resumed" badge is a claim about work that started.
    expect(fakeDeps.chatService.resolveAllCancelledForJob).not.toHaveBeenCalled();
  });

  it('409 universal-resume-ref-unresolvable when neither the mapping nor disk knows the job', async () => {
    makeUniversalProject();
    jobMapping = null;

    const res = await post('/jobs/crashed-run/resume', { projectId: 'p1', featureName: 'universal' });
    expect(res.status).toBe(409);
    const body = await res.json() as any;
    expect(body.code).toBe('universal-resume-ref-unresolvable');
    // A code the client can branch on, and a message it can show.
    expect(typeof body.message).toBe('string');
    expect(fakeDeps.executeJob).not.toHaveBeenCalled();
  });

  it('409 universal-resume-no-turn when there is neither a session nor a recoverable directive', async () => {
    makeUniversalProject();
    jobMapping = { customJobRef: 'agent-builder/author' };
    fakeDeps.chatService.findInterruptedTurn.mockResolvedValueOnce(null);

    const res = await post('/jobs/crashed-run/resume', { projectId: 'p1', featureName: 'universal' });
    expect(res.status).toBe(409);
    expect((await res.json() as any).code).toBe('universal-resume-no-turn');
    expect(fakeDeps.executeJob).not.toHaveBeenCalled();
  });
});
