/**
 * tasks/error/index.ts — error task bundle.
 *
 * Error tasks carry four domain-specific fields on `CodeTask`
 * (`prePlanText`, `errors`, `category`, `remediationMode`) — see
 * `model/ErrorTaskData.ts` for the read accessor.
 *
 * Hooks published:
 *   - decompose.isExclusive        — error tasks always head-of-queue
 *   - conversations.convKey        — per-task conversation scope
 *   - plan.buildPrompt             — renders the error-variant plan prompt
 *                                    (T6b-β; port of planGeneration.ts
 *                                    L150~172)
 *   - plan.toolLoopLogTemplate     — plan-toolLoop debug log path
 *   - orchestrator.onTaskComplete  — auto-enqueue Final Verification
 *                                    recheck after an error task completes
 *                                    (T6b-γ; port of graph.ts L309 + L511)
 */

import type { TaskHooks } from '../_shared/types';

import { isExclusive } from './hooks/decompose';
import { convKey } from './hooks/conversations';
import { buildPrompt as planBuildPrompt } from './hooks/plan';
import { onTaskComplete as orchestratorOnTaskComplete } from './hooks/orchestrator';

export const hooks: TaskHooks = {
  decompose: { isExclusive },
  conversations: { convKey },
  plan: {
    buildPrompt: planBuildPrompt,
    toolLoopLogTemplate: 'jobs/code/nodes/plan/variants/error/base',
  },
  orchestrator: {
    // Error tasks do not publish `hasOwnAttemptCounter` / `attemptCount` /
    // `attachSnapshot` / `restoreIntoWorkerState`. When the orchestrator
    // classifies a transient failure it falls back to the shared
    // `task._failedAttempts` tally (see `parallel/TaskOrchestrator.ts`
    // ~L523). Verification owns its own counter via the Session; error
    // does not — only the post-completion side effect below lives on the
    // error bundle.
    onTaskComplete: orchestratorOnTaskComplete,
  },
};

export { isErrorTask } from './model/is';
export { readErrorData, hasPrePlanText } from './model/ErrorTaskData';
export type { ErrorTaskData, RemediationMode } from './model/ErrorTaskData';
