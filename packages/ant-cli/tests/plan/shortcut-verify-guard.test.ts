/**
 * L1 — `maybeResumeInterrupted` verify-mode regression guard
 * (vast-curling-perch follow-up).
 *
 * Verification responsibility tasks (`isVerifyModeActive(state) === true`)
 * MUST always re-run gates via the plan-tool-loop on fresh entry. The
 * resume shortcut in `nodes/plan/shortcut/` is designed for apply-mode
 * tasks (resume after pause with a finished planText) and has no business
 * firing on a verification cycle — doing so would let a stale
 * `state.planText` from a previous cycle's snapshot bypass the
 * explicit-batches fan-out contract.
 *
 * (The sibling `maybePrePlannedFastPath` shortcut this file also guarded
 * was retired outright — no task type may bypass the plan phase on the
 * strength of a carried recipe; see
 * `tests/plan/preplan-text-shortcut-gate.test.ts` for the retirement lock.)
 */

import { describe, it, expect } from 'vitest';
import { maybeResumeInterrupted } from '../../src/agents/architect/graph/code/nodes/plan/shortcut';
import type { ArchitectGraphState } from '../../src/agents/architect/graph/code/state';
import type { CodeTask } from '../../src/agents/architect/types/task';

const noopWorkflowExit = async (_s: ArchitectGraphState): Promise<void> => { /* no-op */ };

function buildVerificationTask(overrides: Partial<CodeTask> = {}): CodeTask {
  return {
    id: 'verification',
    name: 'Build & Type Verification',
    description: 'verify',
    type: 'verification',
    priority: 1000,
    ...overrides,
  } as CodeTask;
}

describe('maybeResumeInterrupted — verify-mode invariant guard', () => {
  it('returns null when isVerifyModeActive(state) is true even if all legacy conditions match', async () => {
    // Construct the worst-case scenario: nextTask.interrupted=true,
    // state.planText > 50 chars, isVerifyModeActive=true. The legacy
    // conditions would fire and skip plan; the guard must prevent that.
    const verifTask = buildVerificationTask({ interrupted: true });
    const state = {
      currentTask: verifTask,
      _verifyEntered: true,                                      // → isVerifyModeActive=true
      planText: 'x'.repeat(200),
      conversations: {},
      recursionCount: 0,
      recursionLimit: 200,
    } as unknown as ArchitectGraphState;

    const result = await maybeResumeInterrupted(
      state,
      { nextTask: verifTask, isRetry: false, skipKeywordAndRAG: false, inToolLoop: false },
      noopWorkflowExit,
    );

    expect(result).toBeNull();
  });

  it('still resumes apply-mode tasks (verify-mode inactive) under the legacy conditions', async () => {
    // Guard MUST NOT regress the original behaviour for non-verify tasks
    // that were genuinely interrupted with a finished planText (e.g. a
    // feature task paused mid-execute by recursion limit).
    const featTask: CodeTask = {
      id: 'feat1',
      name: 'feature task',
      description: 'apply mode',
      type: 'feature',
      priority: 400,
      interrupted: true,
    } as CodeTask;
    const state = {
      currentTask: featTask,
      _verifyEntered: false,                                     // → isVerifyModeActive=false
      planText: 'a'.repeat(200),
      conversations: {},
      recursionCount: 0,
      recursionLimit: 200,
    } as unknown as ArchitectGraphState;

    const result = await maybeResumeInterrupted(
      state,
      { nextTask: featTask, isRetry: false, skipKeywordAndRAG: false, inToolLoop: false },
      noopWorkflowExit,
    );

    expect(result).not.toBeNull();
    expect(result!._activePhase).toBe('execute');
    expect(result!.planText).toBe(state.planText);
  });
});
