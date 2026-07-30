/**
 * prePlanText consumption contract — the identity-shortcut is retired.
 *
 * History: `nodes/plan/shortcut/prePlanned.ts` used to adopt an error
 * sub-task's `prePlanText` verbatim as `state.planText` (plan LLM skipped
 * entirely, execute framed it as "FOLLOW EXACTLY"). That let unverified
 * parent diagnoses run unopposed — the focal-molding-board incident:
 * pre-authored causal hypotheses are self-certified by the same LLM whose
 * overconfidence is the failure mode, so no task type may bypass the plan
 * phase on the strength of a carried recipe.
 *
 * New contract locked here:
 *   1. NO task bundle publishes a plan-bypass flag (`acceptsPrePlanText`
 *      is removed from `TaskPlanHook`); every batch-split sub-type enters
 *      the plan-tool-loop.
 *   2. The shortcut barrel no longer exports the fast path.
 *   3. The parent's diagnostic still reaches the error sub-task — as
 *      plan-tool-loop INPUT via the error plan hook's diagnostic-carry
 *      vars (`tests/plan/preplan-text-prompt-injection.test.ts` locks the
 *      render side).
 *
 * Retry-counter semantics (heavy-grading-folio) are owned by
 * `tests/plan/plan-retry-counter.test.ts` — the shortcut's `retries`
 * clobber hazard died with the shortcut.
 */

import { describe, it, expect } from 'vitest';
import type { TaskType } from '@ant/shared';
import { hooksForTaskType } from '../../src/agents/architect/graph/code/tasks/_shared/registry';
import * as shortcutBarrel from '../../src/agents/architect/graph/code/nodes/plan/shortcut';

const ALL_TYPES: TaskType[] = [
  'error',
  'test-code',
  'feature',
  'ui',
  'verification',
  'setup',
  'design-system',
  'doc',
  'explain',
];

describe('plan-bypass flag — retired for every task type', () => {
  it.each(ALL_TYPES)(
    '%s publishes no acceptsPrePlanText flag (plan-tool-loop is mandatory)',
    (type) => {
      const planHook = hooksForTaskType(type)?.plan as
        | Record<string, unknown>
        | undefined;
      expect(planHook?.['acceptsPrePlanText']).toBeUndefined();
    },
  );
});

describe('shortcut barrel — identity fast path removed', () => {
  it('does not export maybePrePlannedFastPath', () => {
    expect(
      (shortcutBarrel as Record<string, unknown>)['maybePrePlannedFastPath'],
    ).toBeUndefined();
  });

  it('still exports the resume + setup shortcuts (unrelated, must survive)', () => {
    expect(typeof shortcutBarrel.maybeResumeInterrupted).toBe('function');
    expect(typeof shortcutBarrel.maybeSetupFastPath).toBe('function');
  });
});
