/**
 * Paused non-task job selector — Invariant I1 SSOT (FE side).
 *
 * Locks the contract that `selectPausedNonTaskJob` returns:
 *   • the paused plan or visual job from `state.activeJobs` when one exists
 *   • null when no non-task job is paused (running plan, paused code, etc.)
 *
 * The selector is the single read site every FE enqueue path consults
 * (ClarifyingVariant submit handlers, useChatSubmit normal-path,
 * useJobExecution.runJob jobType reconciliation, activeJobsBootstrap
 * auto-select tiebreaker). A regression here re-opens the
 * zonal-dreaming-novel hole.
 */

import { describe, it, expect } from 'vitest';
import { selectPausedNonTaskJob } from '../pausedNonTaskJob';
import type { StoreState } from '../../types';

function fakeState(activeJobs: StoreState['activeJobs']): StoreState {
  // Only the field the selector reads — keeps the test isolated from
  // the rest of the store shape.
  return { activeJobs } as unknown as StoreState;
}

describe('selectPausedNonTaskJob — Invariant I1', () => {
  it('returns the paused plan job with planner agent', () => {
    const result = selectPausedNonTaskJob(
      fakeState({
        plan: { jobId: 'lunar-braking-onion', status: 'paused', agent: 'planner' },
      }),
    );
    expect(result).toEqual({
      jobType: 'plan',
      agent: 'planner',
      jobId: 'lunar-braking-onion',
    });
  });

  it('returns the paused visual job with creator agent', () => {
    const result = selectPausedNonTaskJob(
      fakeState({
        visual: { jobId: 'paused-visual-1', status: 'paused', agent: 'creator' },
      }),
    );
    expect(result).toEqual({
      jobType: 'visual',
      agent: 'creator',
      jobId: 'paused-visual-1',
    });
  });

  it('falls back to resolveAgentForJobType when the entry omits agent', () => {
    const result = selectPausedNonTaskJob(
      fakeState({
        plan: { jobId: 'no-agent-job', status: 'paused' },
      }),
    );
    expect(result?.agent).toBe('planner');
  });

  it('returns null when only a paused decomposable job exists (code)', () => {
    const result = selectPausedNonTaskJob(
      fakeState({
        code: { jobId: 'paused-code', status: 'paused', agent: 'architect' },
      }),
    );
    expect(result).toBeNull();
  });

  it('returns null when the non-task job is running, not paused', () => {
    const result = selectPausedNonTaskJob(
      fakeState({
        plan: { jobId: 'running-plan', status: 'running', agent: 'planner' },
      }),
    );
    expect(result).toBeNull();
  });

  it('returns null when activeJobs is empty', () => {
    const result = selectPausedNonTaskJob(fakeState({}));
    expect(result).toBeNull();
  });

  it('prefers the first paused non-task entry when both plan and visual are paused (deterministic order)', () => {
    const result = selectPausedNonTaskJob(
      fakeState({
        // Object key insertion order matters — plan first.
        plan: { jobId: 'plan-1', status: 'paused', agent: 'planner' },
        visual: { jobId: 'visual-1', status: 'paused', agent: 'creator' },
      }),
    );
    // Either is correct from an Invariant I1 standpoint (both win over
    // selectedJobType drift), but we lock the deterministic answer to
    // catch silent reordering.
    expect(result?.jobType).toBe('plan');
  });

  it('skips a running non-task job and returns the paused one', () => {
    const result = selectPausedNonTaskJob(
      fakeState({
        plan: { jobId: 'plan-running', status: 'running', agent: 'planner' },
        visual: { jobId: 'visual-paused', status: 'paused', agent: 'creator' },
      }),
    );
    expect(result?.jobType).toBe('visual');
    expect(result?.jobId).toBe('visual-paused');
  });
});
