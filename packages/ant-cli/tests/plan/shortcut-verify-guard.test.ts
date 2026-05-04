/**
 * L1 — `maybePrePlannedFastPath` / `maybeResumeInterrupted` regression
 * guards (vast-curling-perch follow-up).
 *
 * Verification responsibility tasks (`isVerifyModeActive(state) === true`)
 * MUST always re-run gates via the plan-tool-loop on fresh entry. The two
 * skip-plan shortcuts in `nodes/plan/shortcut/` are designed for
 * apply-mode tasks (resume after pause / batch-split sub-task with fixed
 * scope) and have no business firing on a verification cycle — doing so
 * would let a stale `state.planText` from a previous cycle's snapshot or
 * an accidentally-published `acceptsPrePlanText:true` flag bypass the
 * always-fan-out contract.
 *
 * Today the conditions don't accidentally fire (TaskWorker forces
 * `task.interrupted=false` before graph.invoke, snapshot.planText is `''`,
 * and the verification bundle does not publish `acceptsPrePlanText`). The
 * guards below codify the invariant so a future change to either
 * pre-condition cannot silently bypass verification.
 */

import { describe, it, expect } from 'vitest';
import { maybePrePlannedFastPath, maybeResumeInterrupted } from '../../src/agents/architect/graph/code/nodes/plan/shortcut';
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

function buildErrorSubTask(prePlanText: string): CodeTask {
  return {
    id: 'err-batch-1',
    // LLM-authored verbatim shape (per BatchSplit naming contract — no system
    // prefix). Sub-task fixtures here are illustrative; the prefix-test
    // checks are owned by `processDiagnosticBatchSplit.test.ts`.
    name: 'remediate import resolution failures',
    description: 'sub',
    type: 'error',
    priority: 999,
    prePlanText,
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

describe('maybePrePlannedFastPath — verify-mode invariant guard', () => {
  it('returns null when isVerifyModeActive(state) is true (defence-in-depth even though verification bundle lacks acceptsPrePlanText)', async () => {
    // Hypothetical: a future verification bundle (or a misconfigured
    // hooked task) accidentally publishes `acceptsPrePlanText:true` and
    // ends up holding a non-empty prePlanText. The guard must short-
    // circuit before the dispatch-flag check.
    const verifTask = buildVerificationTask({
      prePlanText: '{"task":{"id":"v1"}}'.padEnd(200, ' '),
    });
    const state = {
      currentTask: verifTask,
      _verifyEntered: true,
      conversations: {},
      recursionCount: 0,
      recursionLimit: 200,
    } as unknown as ArchitectGraphState;

    const result = await maybePrePlannedFastPath(
      state,
      { nextTask: verifTask, isRetry: false, skipKeywordAndRAG: false, inToolLoop: false },
      noopWorkflowExit,
    );

    expect(result).toBeNull();
  });

  it('still fires for batch-split error sub-task (acceptsPrePlanText=true, verify-mode inactive)', async () => {
    // Guard MUST NOT regress the primary intended consumer: error/test-code
    // sub-tasks spawned by batch-split that carry a fixed-scope prePlanText.
    const errTask = buildErrorSubTask('{"task":{"id":"err-batch-1"}}'.padEnd(200, ' '));
    const state = {
      currentTask: errTask,
      _verifyEntered: false,                                     // apply-mode dispatch
      conversations: {},
      recursionCount: 0,
      recursionLimit: 200,
    } as unknown as ArchitectGraphState;

    const result = await maybePrePlannedFastPath(
      state,
      { nextTask: errTask, isRetry: false, skipKeywordAndRAG: false, inToolLoop: false },
      noopWorkflowExit,
    );

    expect(result).not.toBeNull();
    expect(result!._activePhase).toBe('execute');
    expect(result!.planText).toBe(errTask.prePlanText);
  });
});
