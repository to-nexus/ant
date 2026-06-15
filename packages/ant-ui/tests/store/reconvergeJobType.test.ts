/**
 * Regression guard for the job-identity divergence bug.
 *
 * The board followed the live job (shouldApplyKanban clause 3) while the chat
 * toolbar / workflow graph / job history followed `selectedJobType`, which
 * converged to the live job only once (at job start). After a manual desync
 * (selecting a past job mid-run, then switching the toolbar type), nothing
 * re-converged `selectedJobType`, so a live code job rendered "as a design
 * job workflow".
 *
 * `shouldReconvergeJobType` is the predicate behind continuous single-owner
 * re-convergence: the LIVE job's broadcasts re-converge the identity to its
 * own type. It fires once per actual divergence (guarded), never for a
 * passively-viewed past job, and honors Invariant I4 (a paused non-task job
 * owns the identity).
 */

import { describe, it, expect } from 'vitest';
import { shouldReconvergeJobType } from '../../src/domain/store/slices/sse/reconvergeJobType';

const noActive = { activeJobs: {} as Record<string, { status: string }> };

describe('shouldReconvergeJobType', () => {
  it('re-converges when a live job diverges from the selected type (the bug)', () => {
    expect(
      shouldReconvergeJobType({ jobType: 'code', dataSource: 'live' }, { selectedJobType: 'design', ...noActive }),
    ).toBe(true);
    expect(
      shouldReconvergeJobType({ jobType: 'code', dataSource: 'estimating' }, { selectedJobType: 'design', ...noActive }),
    ).toBe(true);
  });

  it('no-ops when already converged (breaks the loop / no fetch storm)', () => {
    expect(
      shouldReconvergeJobType({ jobType: 'code', dataSource: 'live' }, { selectedJobType: 'code', ...noActive }),
    ).toBe(false);
  });

  it('does not re-converge for a non-live (session/snapshot) broadcast', () => {
    // A passively-viewed past job must never flip the toolbar.
    expect(
      shouldReconvergeJobType({ jobType: 'code', dataSource: 'session' }, { selectedJobType: 'design', ...noActive }),
    ).toBe(false);
  });

  it('does not re-converge a job-agnostic broadcast (no jobType)', () => {
    expect(
      shouldReconvergeJobType({ jobType: undefined, dataSource: 'live' }, { selectedJobType: 'design', ...noActive }),
    ).toBe(false);
  });

  it('honors Invariant I4 — a paused non-task job keeps the identity', () => {
    // A paused plan job (awaiting a clarify answer) owns the view; a concurrent
    // running code job must not stomp it.
    expect(
      shouldReconvergeJobType(
        { jobType: 'code', dataSource: 'live' },
        { selectedJobType: 'plan', activeJobs: { plan: { status: 'paused' } } },
      ),
    ).toBe(false);
  });

  it('still re-converges past a RUNNING (non-paused) non-task job', () => {
    // Only a *paused* non-task job is protected; a merely-running one yields.
    expect(
      shouldReconvergeJobType(
        { jobType: 'code', dataSource: 'live' },
        { selectedJobType: 'plan', activeJobs: { plan: { status: 'running' } } },
      ),
    ).toBe(true);
  });
});
