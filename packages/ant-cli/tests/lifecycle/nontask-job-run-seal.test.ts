/**
 * Job-tab persistence regression — plan/visual jobs must seal a jobId-stamped
 * SessionRun into `runs[]` so the Job-tab dropdown surfaces them after
 * `currentJobId` moves away.
 *
 * Root cause (before this fix): the `/jobs` endpoint skips any run without a
 * `jobId` (`if (!r.jobId) continue`). Plan/visual never reliably persisted a
 * jobId-keyed run — the planner's own `addRun` omitted `jobId`, and the only
 * jobId-stamping path (`appendJobSnapshotToSession` via the lifecycle finalize)
 * early-returned for boardless jobs. The `212afe43` fix only widened the READ
 * filter; the write side stayed broken.
 *
 * This locks the two write-side guarantees of the fix:
 *   1. A minimal (empty) board — what JobCleanupManager now synthesizes for a
 *      non-task job from the AUTHORITATIVE finalizing jobId — still seals a
 *      jobId-stamped, endpoint-visible run.
 *   2. The planner's jobId-carrying `addRun` and the later lifecycle seal
 *      CONVERGE onto ONE run (upsert by jobId), not a jobId-less phantom + a
 *      second row. The planner's input/output summary survives the merge.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { appendJobSnapshotToSession } from '../../src/periphery/adapters/http/routes/helpers/sessionCleanup';
import { getSessionFilePathByJob } from '../../src/core/utils/sessionPaths';
import type { SessionRun } from '../../src/core/types/session';
import type { KanbanData } from '@ant/shared';

// The minimal board JobCleanupManager synthesizes for a non-task job when
// `getFinalSnapshotKanbanData` yields no board — stamped with the finalizing
// jobId, no tasks (plan/visual render no kanban board).
const emptyBoard = (jobId: string): KanbanData =>
  ({
    jobId,
    todo: [],
    inProgress: [],
    completed: [],
    isEstimating: false,
    dataSource: 'session',
  } as any);

describe('non-task job run seal (Job-tab persistence)', () => {
  let featurePath: string;

  const sessionPathFor = (jobType: 'plan' | 'visual') =>
    getSessionFilePathByJob(featurePath, jobType);
  const writeSession = (jobType: 'plan' | 'visual', runs: SessionRun[]) => {
    const p = sessionPathFor(jobType);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ runs, state: {} }, null, 2));
  };
  const readRuns = (jobType: 'plan' | 'visual'): SessionRun[] =>
    JSON.parse(fs.readFileSync(sessionPathFor(jobType), 'utf-8')).runs;

  beforeEach(() => {
    featurePath = fs.mkdtempSync(path.join(os.tmpdir(), 'nontask-seal-'));
  });
  afterEach(() => {
    fs.rmSync(featurePath, { recursive: true, force: true });
  });

  it('seals a jobId-stamped run for a plan job from an empty board (no prior run)', async () => {
    // Mirrors bug #1's no-artifact case: the planner addRun never ran, so the
    // lifecycle seal alone must guarantee the dropdown row.
    writeSession('plan', []);

    await appendJobSnapshotToSession(featurePath, 'plan', 'true-naming-blaze', emptyBoard('true-naming-blaze'), 'completed');

    const runs = readRuns('plan');
    expect(runs).toHaveLength(1);
    expect(runs[0].jobId).toBe('true-naming-blaze');
    expect(runs[0].status).toBe('completed');
    // Endpoint visibility contract: the run carries a jobId (survives `if (!r.jobId) continue`).
    expect(runs[0].jobId).toBeTruthy();
  });

  it('seals a jobId-stamped run for a visual job from an empty board', async () => {
    writeSession('visual', []);

    await appendJobSnapshotToSession(featurePath, 'visual', 'quiet-rolling-vine', emptyBoard('quiet-rolling-vine'), 'completed');

    const runs = readRuns('visual');
    expect(runs).toHaveLength(1);
    expect(runs[0].jobId).toBe('quiet-rolling-vine');
    expect(runs[0].status).toBe('completed');
  });

  it('CONVERGES the planner jobId run and the lifecycle seal onto ONE run (upsert, no phantom)', async () => {
    // Seed the run the planner now writes (jobId + summary, no snapshot yet).
    writeSession('plan', [
      {
        runId: 1,
        job: 'plan',
        timestamp: '2026-07-08T06:27:30.000Z',
        jobId: 'bright-giving-booth',
        status: 'completed',
        completedAt: '2026-07-08T06:27:30.000Z',
        input: { type: 'directive', summary: 'improve the marketing site' } as any,
        output: { planSummary: 'generate completed (1234 chars)' } as any,
      } as any,
    ]);

    // Lifecycle seal fires later with the minimal board for the SAME jobId.
    await appendJobSnapshotToSession(featurePath, 'plan', 'bright-giving-booth', emptyBoard('bright-giving-booth'), 'completed');

    const runs = readRuns('plan');
    expect(runs).toHaveLength(1); // upsert, not a second row
    expect(runs[0].jobId).toBe('bright-giving-booth');
    expect(runs[0].status).toBe('completed');
    expect(runs[0].kanbanSnapshot).toBeTruthy(); // merged from the lifecycle seal
    // The planner's semantic summary survives the merge.
    expect((runs[0].output as any).planSummary).toContain('generate completed');
    expect((runs[0].input as any).summary).toContain('marketing site');
  });
});
