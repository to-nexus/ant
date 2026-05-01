/**
 * tasks/verification/index.ts — verification task bundle (thin shim).
 *
 * Tier 3/4 dedicated verification task. The bundle now delegates the
 * verification-mode hook surface to `tasks/_shared/verify/` so the same
 * Session, plan/execute/command/check/router/orchestrator behaviour
 * powers self-verify Tier 2 tasks (error/feature/ui/setup with
 * `selfVerifyOnDone:true`) through `composeBundle`.
 *
 * What stays here:
 *   - `model/is.ts` (`isVerificationTask`) — verification task type's
 *     decompose-time identifier; the predicate is read across the
 *     codebase to distinguish "this is the dedicated final-verification
 *     task" from "this is a Tier 2 self-verify task that owns
 *     verification responsibility transiently".
 *   - `hooks/decompose.ts` (`isExclusive`) — verification tasks always
 *     act as a queue-wide barrier.
 *   - `hooks/conversations.ts` (`convKey`) — verification-task-id-scoped
 *     conversation key (per-task thread).
 *
 * Everything else is `_shared/verify/`. Adding new shared verify-mode
 * behaviour: extend `_shared/verify/`. Adding new verification-task-only
 * behaviour: keep it in this directory.
 */

import type { TaskHooks } from '../_shared/types';

// Verification-task-type-only hooks
import { isExclusive } from './hooks/decompose';
import { convKey } from './hooks/conversations';

// Shared verify-mode hooks (also used by composeBundle for self-verify tasks)
import {
  initSession,
  handleFreshEntry,
  buildPrompt as planBuildPrompt,
  checkRetryTermination,
} from '../_shared/verify';
import { executeHook } from '../_shared/verify/executeHook';
import { onEvent } from '../_shared/verify/toolHook';
import { guard } from '../_shared/verify/commandGuard';
import { evaluate, budgetExhaustedHint } from '../_shared/verify/checkEvaluate';
import { routeAfterDone } from '../_shared/verify/router';
import {
  hasOwnAttemptCounter,
  attemptCount,
  restoreIntoWorkerState,
} from '../_shared/verify/orchestrator';

export const hooks: TaskHooks = {
  plan: {
    initSession,
    handleFreshEntry,
    buildPrompt: planBuildPrompt,
    toolLoopLogTemplate: 'jobs/code/nodes/plan/variants/verification/rules',
    checkRetryTermination,
    // Verification's signature: no plan-text body (only gate diagnostics
    // drive the cycle), uses the plan↔tool loop, exclusive paths-only
    // RAG fast-path, allows empty-impl shortcut (gates passed → done).
    requiresPlanText: false,
    usesToolLoop: true,
    exclusiveFastpath: true,
    allowsEmptyImplShortcut: true,
  },
  execute: executeHook,
  tool: { onEvent },
  command: { guard },
  check: { evaluate, budgetExhaustedHint },
  router: { routeAfterDone },
  orchestrator: {
    hasOwnAttemptCounter,
    attemptCount,
    restoreIntoWorkerState,
  },
  decompose: { isExclusive },
  conversations: { convKey },
};

export { isVerificationTask } from './model/is';
