/**
 * Plan B — `acceptsPrePlanText` publishing gate.
 *
 * After Plan B (noble-coating-lathe follow-up), the identity-shortcut at
 * `nodes/plan/shortcut/prePlanned.ts` fires for ERROR sub-tasks only.
 * Verification's diagnostic is the plan; re-running a plan-tool-loop would
 * cascade. Other batch-split sub-tasks (test-code / feature / ui) MUST
 * enter the plan-tool-loop so the LLM can detect sibling drift before
 * emitting `planText`.
 *
 * This test locks two contracts:
 *   1. Only `error` publishes `acceptsPrePlanText:true` in the registry.
 *   2. `maybePrePlannedFastPath` short-circuits for error sub-tasks but
 *      returns `null` for test-code / feature / ui (so they fall through
 *      to the normal plan path).
 *
 * Regression guard: a future bundle that re-publishes
 * `acceptsPrePlanText:true` on test-code / feature / ui would re-introduce
 * the silent execute-toolLoop drift loop (recursion limit 200 hit in
 * noble-coating-lathe / tweet-detail-orchestration).
 */

import { describe, it, expect } from 'vitest';
import type { TaskType } from '@ant/shared';
import { hooksForTaskType } from '../../src/agents/architect/graph/code/tasks/_shared/registry';
import { maybePrePlannedFastPath } from '../../src/agents/architect/graph/code/nodes/plan/shortcut';
import type { ArchitectGraphState } from '../../src/agents/architect/graph/code/state';
import type { CodeTask } from '../../src/agents/architect/types/task';

const noopWorkflowExit = async (_s: ArchitectGraphState): Promise<void> => { /* no-op */ };

function buildTask(type: TaskType, prePlanText: string | undefined): CodeTask {
  return {
    id: `${type}-1`,
    name: `${type} sub-task`,
    description: 'sub',
    type,
    priority: 300,
    ...(prePlanText !== undefined ? { prePlanText } : {}),
  } as CodeTask;
}

function buildState(task: CodeTask): ArchitectGraphState {
  return {
    currentTask: task,
    _verifyEntered: false,
    conversations: {},
    recursionCount: 0,
    recursionLimit: 200,
  } as unknown as ArchitectGraphState;
}

describe('acceptsPrePlanText — registry publication gate', () => {
  it('error publishes acceptsPrePlanText:true', () => {
    expect(hooksForTaskType('error')?.plan?.acceptsPrePlanText).toBe(true);
  });

  it.each<TaskType>([
    'test-code',
    'feature',
    'ui',
    'verification',
    'setup',
    'design-system',
    'doc',
    'explain',
  ])('%s does NOT publish acceptsPrePlanText (must enter plan-tool-loop)', (type) => {
    expect(hooksForTaskType(type)?.plan?.acceptsPrePlanText).not.toBe(true);
  });
});

describe('maybePrePlannedFastPath — shortcut firing scope', () => {
  it('error sub-task with prePlanText short-circuits to execute', async () => {
    const task = buildTask('error', '{"task":{"id":"err"}}'.padEnd(200, ' '));
    const state = buildState(task);
    const result = await maybePrePlannedFastPath(
      state,
      { nextTask: task, isRetry: false, skipKeywordAndRAG: false, inToolLoop: false },
      noopWorkflowExit,
    );
    expect(result).not.toBeNull();
    expect(result!._activePhase).toBe('execute');
    expect(result!.planText).toBe(task.prePlanText);
  });

  it('error sub-task short-circuit survives retry (isRetry=true)', async () => {
    // The shortcut gate is `(!isRetry || isBatchSplitSub)`. For error
    // sub-tasks isBatchSplitSub === true, so retry MUST also fire the
    // shortcut (the fresh diagnostic is still the plan).
    const task = buildTask('error', '{"task":{"id":"err"}}'.padEnd(200, ' '));
    const state = buildState(task);
    const result = await maybePrePlannedFastPath(
      state,
      { nextTask: task, isRetry: true, skipKeywordAndRAG: false, inToolLoop: false },
      noopWorkflowExit,
    );
    expect(result).not.toBeNull();
    expect(result!._activePhase).toBe('execute');
  });

  it.each<TaskType>(['test-code', 'feature', 'ui'])(
    '%s sub-task with prePlanText falls through to plan-tool-loop (returns null)',
    async (type) => {
      const task = buildTask(type, '{"task":{"id":"sub"}}'.padEnd(200, ' '));
      const state = buildState(task);
      const result = await maybePrePlannedFastPath(
        state,
        { nextTask: task, isRetry: false, skipKeywordAndRAG: false, inToolLoop: false },
        noopWorkflowExit,
      );
      expect(result).toBeNull();
    },
  );
});
