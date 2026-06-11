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
