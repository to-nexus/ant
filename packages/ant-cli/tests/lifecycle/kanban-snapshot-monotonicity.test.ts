/**
 * `plain-dimming-flock` regression — a previously-COMPLETED per-jobId kanban
 * snapshot must never be demoted/clobbered back to a stale paused/partial
 * board by a later re-finalize that reads the shared, last-writer-wins
 * `session.state` slot.
 *
 * Two layers are locked here:
 *   1. `wouldRegressRun` — the shared monotonicity SSOT (pure).
 *   2. `appendJobSnapshotToSession` — the single write chokepoint every
 *      lifecycle path funnels through. It must:
 *        - refuse a completed→paused demotion,
 *        - refuse a completed-count regression,
 *        - refuse a cross-jobId snapshot (identity mismatch),
 *        - still allow legitimate forward progress (≥ completed, or refresh).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { wouldRegressRun } from '../../src/core/utils/sessionRunGuard';
import { appendJobSnapshotToSession } from '../../src/periphery/adapters/http/routes/helpers/sessionCleanup';
import { getSessionFilePathByJob } from '../../src/core/utils/sessionPaths';
import type { SessionRun } from '../../src/core/types/session';
import type { KanbanData } from '@ant/shared';

const completedTasks = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `t${i}`, status: 'completed', completed: true }));

const snap = (jobId: string, done: number, todo = 0): KanbanData =>
  ({
    jobId,
    todo: Array.from({ length: todo }, (_, i) => ({ id: `q${i}` })),
    inProgress: [],
    completed: completedTasks(done),
    isEstimating: false,
    dataSource: 'session',
  } as any);

describe('wouldRegressRun (monotonicity SSOT)', () => {
  const completedRun = (done: number): SessionRun =>
    ({ runId: 1, job: 'code', timestamp: '', jobId: 'X', status: 'completed', kanbanSnapshot: snap('X', done) } as any);

  it('refuses completed → paused demotion', () => {
    expect(wouldRegressRun(completedRun(63), 'paused', snap('X', 6))).toBe(true);
  });

  it('refuses a completed-count regression even when status stays', () => {
    expect(wouldRegressRun(completedRun(63), 'completed', snap('X', 6))).toBe(true);
  });

  it('allows forward progress (more completed)', () => {
    expect(wouldRegressRun(completedRun(6), 'completed', snap('X', 63))).toBe(false);
  });

  it('allows a same-count completed refresh', () => {
    expect(wouldRegressRun(completedRun(63), 'completed', snap('X', 63))).toBe(false);
  });
});

describe('appendJobSnapshotToSession write chokepoint', () => {
  let featurePath: string;
  let sessionPath: string;

  const writeSession = (runs: SessionRun[]) => {
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(sessionPath, JSON.stringify({ runs, state: {} }, null, 2));
  };
  const readRuns = (): SessionRun[] => JSON.parse(fs.readFileSync(sessionPath, 'utf-8')).runs;

  beforeEach(() => {
    featurePath = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-'));
    sessionPath = getSessionFilePathByJob(featurePath, 'code');
  });
  afterEach(() => {
    fs.rmSync(featurePath, { recursive: true, force: true });
  });

  it('does NOT demote a completed run to paused (the exact clobber)', async () => {
    writeSession([
      { runId: 1, job: 'code', timestamp: '', jobId: 'plain-dimming-flock', status: 'completed', kanbanSnapshot: snap('plain-dimming-flock', 63) } as any,
    ]);

    await appendJobSnapshotToSession(featurePath, 'code', 'plain-dimming-flock', snap('plain-dimming-flock', 6, 57), 'paused');

    const runs = readRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('completed');
    expect(runs[0].kanbanSnapshot!.completed).toHaveLength(63);
    expect(runs[0].kanbanSnapshot!.todo).toHaveLength(0);
  });

  it('refuses a snapshot built for a different jobId (identity guard)', async () => {
    writeSession([
      { runId: 1, job: 'code', timestamp: '', jobId: 'plain-dimming-flock', status: 'completed', kanbanSnapshot: snap('plain-dimming-flock', 63) } as any,
    ]);

    // A board whose own jobId is a DIFFERENT job (shared-state projection bug).
    await appendJobSnapshotToSession(featurePath, 'code', 'plain-dimming-flock', snap('small-mashing-chord', 6), 'paused');

    const runs = readRuns();
    expect(runs[0].status).toBe('completed');
    expect(runs[0].kanbanSnapshot!.completed).toHaveLength(63);
  });

  it('allows a legitimate forward update (paused → completed with more done)', async () => {
    writeSession([
      { runId: 1, job: 'code', timestamp: '', jobId: 'job-x', status: 'paused', kanbanSnapshot: snap('job-x', 6, 57) } as any,
    ]);

    await appendJobSnapshotToSession(featurePath, 'code', 'job-x', snap('job-x', 63), 'completed');

    const runs = readRuns();
    expect(runs[0].status).toBe('completed');
    expect(runs[0].kanbanSnapshot!.completed).toHaveLength(63);
    expect(runs[0].kanbanSnapshot!.todo).toHaveLength(0);
  });

  it('appends a fresh run for a new jobId', async () => {
    writeSession([
      { runId: 1, job: 'code', timestamp: '', jobId: 'job-x', status: 'completed', kanbanSnapshot: snap('job-x', 3) } as any,
    ]);

    await appendJobSnapshotToSession(featurePath, 'code', 'job-y', snap('job-y', 5), 'completed');

    const runs = readRuns();
    expect(runs).toHaveLength(2);
    expect(runs.find((r) => r.jobId === 'job-y')!.kanbanSnapshot!.completed).toHaveLength(5);
  });
});
