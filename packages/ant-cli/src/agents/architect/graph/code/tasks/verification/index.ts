/**
 * tasks/verification/index.ts — verification task bundle.
 *
 * Collects every verification hook into a single `hooks: TaskHooks` export.
 * `tasks/_shared/registry.ts` imports this bundle statically so the phase
 * layer's `hooksIfActive(state)` / `hooksForTaskType('verification')`
 * lookups return the real implementation.
 *
 * At T5 only the hook bodies are wired; phase-layer callers keep their
 * inline logic until T6 flips each call site to delegate here.
 */

import type { TaskHooks } from '../_shared/types';

import { onEvent } from './hooks/tool';
import { guard } from './hooks/command';
import { evaluate, budgetExhaustedHint } from './hooks/check';
import { routeAfterDone } from './hooks/router';
import {
  initSession,
  buildPrompt as planBuildPrompt,
} from './hooks/plan';
import { executeHook } from './hooks/execute';
import {
  hasOwnAttemptCounter,
  attemptCount,
  restoreIntoWorkerState,
} from './hooks/orchestrator';
import { isExclusive } from './hooks/decompose';
import { convKey } from './hooks/conversations';

export const hooks: TaskHooks = {
  plan: {
    initSession,
    buildPrompt: planBuildPrompt,
    // plan-toolLoop debug log uses the verification rules template so the
    // captured prompt reflects the variant actually being exercised.
    toolLoopLogTemplate: 'jobs/code/nodes/plan/variants/verification/rules',
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
