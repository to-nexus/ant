/**
 * tasks/error/index.ts — error task bundle.
 *
 * Error tasks carry four domain-specific fields on `CodeTask`
 * (`prePlanText`, `errors`, `category`, `remediationMode`) read directly
 * from the task at the phase-layer call sites (plan fast-path, execute
 * framing, batch-split emission). An earlier iteration exposed a
 * `readErrorData` / `hasPrePlanText` accessor pair under `model/
 * ErrorTaskData.ts`; it was retired as dead API surface when every
 * consumer settled on direct field access.
 *
 * Hooks published:
 *   - decompose.isExclusive        — error tasks always head-of-queue
 *   - conversations.convKey        — per-task conversation scope
 *   - plan.buildPrompt             — renders the error-variant plan prompt
 *                                    (T6b-β; port of planGeneration.ts
 *                                    L150~172)
 *   - plan.toolLoopLogTemplate     — plan-toolLoop debug log path
 *   - command.guard                — execute-phase build/test/typecheck
 *                                    block (T6b-η; codifies the "error
 *                                    applies fixes only, diagnostics run
 *                                    in the next verification cycle" rule)
 *   - orchestrator.onTaskComplete  — auto-enqueue Final Verification
 *                                    recheck after an error task completes
 *                                    (T6b-γ; port of graph.ts L309 + L511)
 */

import type { TaskHooks } from '../_shared/types';

import { isExclusive } from './hooks/decompose';
import { convKey } from './hooks/conversations';
import { buildPrompt as planBuildPrompt } from './hooks/plan';
import { guard as commandGuard } from './hooks/command';
import { onTaskComplete as orchestratorOnTaskComplete } from './hooks/orchestrator';
import { executeHook } from './hooks/execute';

export const hooks: TaskHooks = {
  decompose: { isExclusive },
  conversations: { convKey },
  plan: {
    buildPrompt: planBuildPrompt,
    toolLoopLogTemplate: 'jobs/code/nodes/plan/variants/error/base',
  },
  execute: executeHook,
  command: { guard: commandGuard },
  orchestrator: {
    // Error tasks do not publish `hasOwnAttemptCounter` / `attemptCount` /
    // `restoreIntoWorkerState`. When the orchestrator classifies a
    // transient failure it falls back to the shared `task._failedAttempts`
    // tally (see `parallel/TaskOrchestrator.ts` ~L523). Verification owns
    // its own counter via the Session; error does not — only the post-
    // completion side effect below lives on the error bundle.
    onTaskComplete: orchestratorOnTaskComplete,
  },
};

export { isErrorTask } from './model/is';
