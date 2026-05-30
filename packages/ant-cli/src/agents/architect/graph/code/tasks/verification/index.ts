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
import { TEMPLATE_PATHS } from '../../../../../../core/prompt/builder/templatePaths';
import { executeHook } from '../_shared/verify/hooks/executeHook';
import { routeAfterDone } from '../_shared/verify/hooks/router';
import { parityCheckEvaluate } from '../_shared/verify/parity';
import { antrulesDecisionCheck } from '../_shared/verify/antrulesDecisionCheck';

/**
 * Hint rendered on the `no_done_signal` violation for verification cycles.
 * Consumed by `checkTaskStatus/evaluate.ts`.
 */
const noDoneSignalHint =
  'Verification task did not complete — build may have failed. Retry pending.';

export const hooks: TaskHooks = {
  plan: {
    buildPrompt: planBuildPrompt,
    toolLoopLogTemplate: TEMPLATE_PATHS.codePlanVerification.rules!,
    // Verification's signature: no plan-text body (only gate diagnostics
    // drive the cycle), uses the plan↔tool loop, exclusive paths-only
    // RAG fast-path. The "empty plan → done" shortcut now lives on the
    // verify-mode dispatch axis (`isVerifyModeActive(state)` checked in
    // `nodes/plan/llm/tools.ts` and `nodes/plan/outcome/finalize.ts`),
    // shared with every Tier-2 self-verify task — no per-type flag needed.
    requiresPlanText: false,
    usesToolLoop: true,
    exclusiveFastpath: true,
  },
  execute: executeHook,
  // Verification task is verify-mode by definition (every run IS a
  // verification cycle). Evaluation order: parity first (build/test
  // actually exercised), then ANTRULES decision gate (cheap textual check
  // that closes Defect 2 silent-skip — Tier 3/4 final verification only;
  // `antrulesDecisionCheck` self-gates on `isVerificationTask`). Tier 2
  // self-verify tasks pick up parity through `composeBundle`'s check
  // wrapper but skip the ANTRULES gate (predicate guards against
  // over-fire — see `feedback-antrules-broad-role`).
  check: {
    noDoneSignalHint,
    evaluate: async (state) => {
      const parityResult = await parityCheckEvaluate(state);
      if (parityResult) return parityResult;
      return antrulesDecisionCheck(state);
    },
  },
  router: { routeAfterDone },
  decompose: { isExclusive },
  conversations: { convKey },
  scheduling: { classify: schedulingClassify },
};

export { isVerificationTask } from './model/is';
