/**
 * tasks/verification/index.ts — verification task bundle (thin shim).
 *
 * Tier 3/4 dedicated verification task. Plan / execute / router / tool /
 * command surface is shared verify-mode infrastructure — published by
 * `composeBundle` (which delegates to `_shared/verify/`). Verification-task-
 * type-only slots (`isExclusive`, `convKey`, `priorErrorTasks`) live here.
 */

import type { TaskHooks } from '../_shared/types';

import { isExclusive } from './hooks/decompose';
import { convKey } from './hooks/conversations';
import { classify as schedulingClassify } from './hooks/scheduling';

import { buildPrompt as planBuildPrompt } from '../_shared/verify/prompt/buildPlanPrompt';
import { executeHook } from '../_shared/verify/hooks/executeHook';
import { routeAfterDone } from '../_shared/verify/hooks/router';
import { parityCheckEvaluate } from '../_shared/verify/parity';

/**
 * Hint rendered on the `budget_exhausted` violation (execute call loop)
 * for verification cycles. Consumed by `checkTaskStatus/evaluate.ts`.
 */
const budgetExhaustedHint =
  'Verification task did not complete — build may have failed. Retry pending.';

export const hooks: TaskHooks = {
  plan: {
    buildPrompt: planBuildPrompt,
    toolLoopLogTemplate: 'jobs/code/nodes/plan/variants/verification/rules',
    // Verification's signature: no plan-text body (only gate diagnostics
    // drive the cycle), uses the plan↔tool loop, exclusive paths-only
    // RAG fast-path, allows empty-impl shortcut (no fixes → done).
    requiresPlanText: false,
    usesToolLoop: true,
    exclusiveFastpath: true,
    allowsEmptyImplShortcut: true,
  },
  execute: executeHook,
  // Verification task is verify-mode by definition (every run IS a
  // verification cycle). `parityCheckEvaluate` self-gates on
  // `state.virtualizationSnapshot?.hasBusinessConnection` — when no
  // business connections exist, the check is a no-op. Tier 2 self-verify
  // tasks pick up the same hook through `composeBundle`'s check wrapper.
  check: { budgetExhaustedHint, evaluate: parityCheckEvaluate },
  router: { routeAfterDone },
  decompose: { isExclusive },
  conversations: { convKey },
  scheduling: { classify: schedulingClassify },
};

export { isVerificationTask } from './model/is';
