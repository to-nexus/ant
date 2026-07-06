/**
 * Regression — `KanbanService.buildSessionKanbanData` read-side safety net.
 *
 * Bug (job `grim-padding-grove`): a cross-pod finalize race (StaleJobRecovery
 * paused a job whose worker child was still alive — and never set the poison
 * lock) let the live child re-write `state.runningTasks` with UNMARKED entries
 * (`interrupted: null`) into a paused session, AFTER cleanupJobState had already
 * projected. The SESSION-path projection split running tasks purely on the
 * per-task `interrupted` flag, so those unmarked tasks rendered as frozen live
 * "in progress" cards forever (`ip=2`), with no resume affordance.
 *
 * Fix: when the job is NOT running AND an interruption is persisted
 * (`isPausedSession`), ALL running tasks (and `currentTask`) are treated as
 * paused → projected into `todo` with `interrupted: true`, never `inProgress`.
 * This is a defensive net: it is a NO-OP in the already-correct flows
 * (completed jobs, normal stops where cleanupJobState cleared runningTasks,
 * live-job page-refresh handled by the LIVE/ESTIMATING branches).
 */

import { describe, it, expect } from 'vitest';
import { KanbanService } from '../../src/periphery/adapters/http/services/KanbanService';

function task(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    type: 'feature',
    timing: { startedAt: '2026-06-11T04:24:36.404Z' },
    ...extra,
  };
}

function buildSession(state: Record<string, unknown>) {
  return { state };
}

// buildSessionKanbanData is a pure derivation (no Redis) — call it directly.
function project(sessionData: any, isActuallyRunning: boolean) {
  const svc = new KanbanService('/tmp/ws-kanban-test');
  return (svc as any).buildSessionKanbanData(sessionData, sessionData.state.jobId, 'code', isActuallyRunning);
}

describe('KanbanService paused-session projection (grim-padding-grove safety net)', () => {
  it('projects UNMARKED running tasks into todo (not inProgress) when paused + not running', () => {
    const session = buildSession({
      jobId: 'grim-padding-grove',
      taskQueue: [task('queued-1')],
      runningTasks: [task('run-a'), task('run-b')], // interrupted is undefined/null
      completedTasks: [],
      completedTasksDetails: [],
      interruption: { reason: 'server_shutdown', message: 'x', canResume: true, timestamp: '2026-06-11T04:26:24.446Z' },
    });

    const k = project(session, /* isActuallyRunning */ false);

    expect(k.inProgress).toHaveLength(0);
    const todoIds = k.todo.map((t: any) => t.id);
    expect(todoIds).toEqual(expect.arrayContaining(['run-a', 'run-b', 'queued-1']));
    // The projected running tasks are stamped paused so the FE renders the Paused badge.
    for (const id of ['run-a', 'run-b']) {
      const t = k.todo.find((x: any) => x.id === id);
      expect(t.interrupted).toBe(true);
      expect(t.timing.pausedAt).toBe('2026-06-11T04:26:24.446Z');
    }
    expect(k.interruption?.canResume).toBe(true);
  });

  it('folds currentTask into the paused todo projection', () => {
    const session = buildSession({
      jobId: 'j1',
      taskQueue: [],
      currentTask: task('cur'),
      runningTasks: [],
      completedTasks: [],
      completedTasksDetails: [],
      interruption: { reason: 'user_stopped', message: 'x', canResume: true, timestamp: 't1' },
    });

    const k = project(session, false);

    expect(k.inProgress).toHaveLength(0);
    expect(k.todo.map((t: any) => t.id)).toContain('cur');
    expect(k.todo.find((t: any) => t.id === 'cur').interrupted).toBe(true);
  });

  it('NO-OP: with no interruption, unmarked running tasks still render as inProgress', () => {
    const session = buildSession({
      jobId: 'j2',
      taskQueue: [],
      runningTasks: [task('run-a')],
      completedTasks: [],
      completedTasksDetails: [],
      // no interruption → not a paused session
    });

    const k = project(session, false);

    expect(k.inProgress.map((t: any) => t.id)).toEqual(['run-a']);
    expect(k.todo).toHaveLength(0);
  });

  it('NO-OP: a marked (interrupted) running task still projects to todo as before', () => {
    const session = buildSession({
      jobId: 'j3',
      taskQueue: [],
      runningTasks: [task('run-a', { interrupted: true })],
      completedTasks: [],
      completedTasksDetails: [],
      // no interruption persisted, but task already marked
    });

    const k = project(session, false);

    expect(k.inProgress).toHaveLength(0);
    expect(k.todo.map((t: any) => t.id)).toEqual(['run-a']);
  });

  it('NO-OP: completed job with cleared runningTasks projects an empty board head', () => {
    const session = buildSession({
      jobId: 'j4',
      taskQueue: [],
      runningTasks: [],
      completedTasks: ['c1'],
      completedTasksDetails: [{ id: 'c1', name: 'c1' }],
      interruption: { reason: 'server_shutdown', message: 'x', canResume: true, timestamp: 't' },
    });

    const k = project(session, false);

    expect(k.inProgress).toHaveLength(0);
    expect(k.todo).toHaveLength(0);
    expect(k.completed.map((t: any) => t.id)).toEqual(['c1']);
  });
});

/**
 * Regression — `KanbanService.getKanbanData` read-side self-heal (focal-jetting-ember).
 *
 * An orphaned job (crashed mid-execution during a deploy; interruption
 * projection never landed) persists `runningTasks` with NO `interruption`.
 * The pure projector correctly keeps those in `inProgress` when called
 * directly (the four NO-OP cases above), because it has no Redis authority.
 * getKanbanData DOES have Redis authority (`isActuallyRunning`), so it must
 * synthesize a default `server_crash` interruption and route through the
 * paused projection — turning the stuck `isRunning=false paused=false ip=1`
 * board into a resumable pause. This is the layer where the fix lives; the
 * pure projector stays unchanged (proven by the NO-OP tests above).
 */
describe('KanbanService getKanbanData orphaned self-heal (focal-jetting-ember)', () => {
  function makeService(sessionData: any, stateStore: any) {
    const workspaceResolver = { getFeaturePath: () => '/tmp/feat' } as any;
    const svc = new KanbanService('/tmp/ws-kanban-test', workspaceResolver, stateStore);
    (svc as any).safeReadSession = async () => sessionData;
    return svc;
  }

  const userContext = { organizationId: 'individual', userId: 'u' } as any;

  it('repro: orphaned runningTasks + no interruption → paused todo + synthesized server_crash (canResume for code)', async () => {
    const sessionData = buildSession({
      jobId: 'focal-jetting-ember',
      taskQueue: [],
      runningTasks: [task('restore-next-image-optimized')],
      completedTasks: [],
      completedTasksDetails: [],
      // interruption UNSET — the poison-gated child never wrote it
    });
    const stateStore = {
      listJobsByFeature: async () => [],           // no running job of this type
      getJobStatus: async () => null,              // Redis has no 'running' record
      getTaskQueue: async () => null,
    };

    const svc = makeService(sessionData, stateStore);
    const k = await svc.getKanbanData('jhedu', 'base', 'code', undefined, undefined, undefined, userContext);

    expect(k.dataSource).toBe('session');
    expect(k.inProgress).toHaveLength(0);
    const t = k.todo.find((x: any) => x.id === 'restore-next-image-optimized');
    expect(t).toBeTruthy();
    expect(t.interrupted).toBe(true);
    expect(k.interruption?.reason).toBe('server_crash');
    expect(k.interruption?.canResume).toBe(true);
  });

  it('plan job: same orphaned shape → synthesized interruption but canResume=false', async () => {
    const sessionData = buildSession({
      jobId: 'some-plan-job',
      taskQueue: [task('q1')],
      runningTasks: [],
      completedTasks: [],
      completedTasksDetails: [],
    });
    const stateStore = {
      listJobsByFeature: async () => [],
      getJobStatus: async () => null,
      getTaskQueue: async () => null,
    };

    const svc = makeService(sessionData, stateStore);
    const k = await svc.getKanbanData('p', 'f', 'plan', undefined, undefined, undefined, userContext);

    expect(k.interruption?.reason).toBe('server_crash');
    expect(k.interruption?.canResume).toBe(false);
  });

  it('NO-OP: completed job (completedAt, no leftover) is NOT self-healed', async () => {
    const sessionData = buildSession({
      jobId: 'done-job',
      taskQueue: [],
      runningTasks: [],
      completedTasks: ['c1'],
      completedTasksDetails: [{ id: 'c1', name: 'c1' }],
      jobTiming: { startedAt: 't0', completedAt: 't1' },
    });
    const stateStore = {
      listJobsByFeature: async () => [],
      getJobStatus: async () => null,
      getTaskQueue: async () => null,
    };

    const svc = makeService(sessionData, stateStore);
    const k = await svc.getKanbanData('p', 'f', 'code', undefined, undefined, undefined, userContext);

    expect(k.interruption).toBeUndefined();
    expect(k.todo).toHaveLength(0);
    expect(k.inProgress).toHaveLength(0);
    expect(k.completed.map((t: any) => t.id)).toEqual(['c1']);
  });

  it('NO-OP: genuinely running job (Redis running + live snapshot) takes the LIVE branch', async () => {
    const sessionData = buildSession({
      jobId: 'live-job',
      taskQueue: [],
      runningTasks: [],
      completedTasks: [],
      completedTasksDetails: [],
    });
    const stateStore = {
      listJobsByFeature: async () => [{ jobId: 'live-job', status: 'running', type: 'code' }],
      getJobStatus: async () => ({ status: 'running', startedAt: new Date().toISOString() }),
      getTaskQueue: async () => ({ queue: [], currentTasks: [task('cur')], completedTasks: [] }),
    };

    const svc = makeService(sessionData, stateStore);
    const k = await svc.getKanbanData('p', 'f', 'code', undefined, undefined, undefined, userContext);

    expect(k.dataSource).toBe('live');
    expect(k.inProgress.map((t: any) => t.id)).toEqual(['cur']);
  });
});
