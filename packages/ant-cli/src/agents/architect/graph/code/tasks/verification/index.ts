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
import { shortCircuitAfterPlan, routeAfterDone } from './hooks/router';
import {
  initSession,
  onEntry,
  classifyEntry,
  decideOutcome,
  maybeSplit,
  makeTerminalError,
  buildPrompt as planBuildPrompt,
} from './hooks/plan';
import {
  hasOwnAttemptCounter,
  captureOnFailure,
  attemptCount,
  attachSnapshot,
  restoreIntoWorkerState,
} from './hooks/orchestrator';
import { isExclusive } from './hooks/decompose';
import { convKey } from './hooks/conversations';

export const hooks: TaskHooks = {
  plan: {
    initSession,
    onEntry,
    classifyEntry,
    decideOutcome,
    maybeSplit,
    makeTerminalError,
    buildPrompt: planBuildPrompt,
    // plan-toolLoop debug log uses the verification rules template so the
    // captured prompt reflects the variant actually being exercised.
    toolLoopLogTemplate: 'jobs/code/nodes/plan/variants/verification/rules',
  },
  tool: { onEvent },
  command: { guard },
  check: { evaluate, budgetExhaustedHint },
  router: { shortCircuitAfterPlan, routeAfterDone },
  orchestrator: {
    hasOwnAttemptCounter,
    captureOnFailure,
    attemptCount,
    attachSnapshot,
    restoreIntoWorkerState,
  },
  decompose: { isExclusive },
  conversations: { convKey },
};

export { isVerificationTask, isFinalVerificationTask } from './model/is';
