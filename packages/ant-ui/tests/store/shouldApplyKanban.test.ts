/**
 * Regression guard for the blank-board-during-decompose bug.
 *
 * The kanban SSE handler used a strict `data.jobType === selectedJobType`
 * guard. `selectedJobType` defaults to `'plan'` and only syncs to the running
 * job AFTER the action resolves, so every pre-task estimating broadcast
 * (triage→detect→decompose, stamped with the real jobType) was dropped and the
 * decompose skeleton never appeared — tasks only showed once the tab synced.
 *
 * `shouldApplyKanban` fixes this: a live/estimating broadcast is the running
 * job for the active feature and must drive the board regardless of the
 * not-yet-synced tab. Job-agnostic → code and design behave identically.
 */

import { describe, it, expect } from 'vitest';
import { shouldApplyKanban } from '../../src/domain/store/slices/sse/shouldApplyKanban';

describe('shouldApplyKanban', () => {
  it('applies a job-agnostic broadcast (no jobType)', () => {
    expect(shouldApplyKanban({ jobType: undefined, dataSource: 'session' }, 'plan')).toBe(true);
  });

  it('applies when jobType matches the viewed tab', () => {
    expect(shouldApplyKanban({ jobType: 'code', dataSource: 'live' }, 'code')).toBe(true);
    expect(shouldApplyKanban({ jobType: 'code', dataSource: 'session' }, 'code')).toBe(true);
  });

  it('applies a CODE estimating broadcast while the tab still defaults to plan (the bug)', () => {
    // The exact failure mode: pre-task decompose broadcast, tab not yet synced.
    expect(shouldApplyKanban({ jobType: 'code', dataSource: 'estimating' }, 'plan')).toBe(true);
    expect(shouldApplyKanban({ jobType: 'code', dataSource: 'live' }, 'plan')).toBe(true);
  });

  it('applies a DESIGN estimating broadcast while the tab still defaults to plan (parity)', () => {
    expect(shouldApplyKanban({ jobType: 'design', dataSource: 'estimating' }, 'plan')).toBe(true);
    expect(shouldApplyKanban({ jobType: 'design', dataSource: 'live' }, 'plan')).toBe(true);
  });

  it('drops a non-live (session) broadcast for a job type the user is not viewing', () => {
    expect(shouldApplyKanban({ jobType: 'design', dataSource: 'session' }, 'plan')).toBe(false);
    expect(shouldApplyKanban({ jobType: 'code', dataSource: 'session' }, 'design')).toBe(false);
  });
});
