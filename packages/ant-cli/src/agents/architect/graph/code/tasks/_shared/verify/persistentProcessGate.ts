/**
 * `_shared/verify/persistentProcessGate` — SSOT for "are persistent processes
 * (and thus the `http_request` route-verification tool) unlocked for this
 * state?".
 *
 * Single predicate consumed by the tool selectors (`plan/tools`,
 * `execute/tools`), the command-policy guard, and the prompt builder
 * (`buildPlanPrompt` passes its result through as `allowPersistentProcesses`),
 * so all four agree with no drift. Unlocks when ANY of:
 *   - error task                          → always
 *     (`tasks/error/hooks/plan.ts` set `allowPersistentProcesses: true`)
 *   - runtime-error-grounded context      → directive pattern OR prior error
 *     sub-tasks present (also surfaced as `hasUserRuntimeErrorContext`); covers
 *     apply-phase tasks in a job whose directive describes a runtime failure
 *   - verify-mode RCA                     → any task in its verification cycle
 *     (verification task OR self-verify reverify). The diagnostic plan is the
 *     RCA + batch-split decision point; route/runtime-shaped failures surfaced
 *     by the gates need the reproduction set (keep_running + http_request) to
 *     be diagnosed before the split is committed. Availability, not a forced
 *     boot-probe — the LLM boots only when it judges RCA needs it. Keyed on
 *     `_verifyEntered` (set on cycle 1 by `handleFreshTaskEntry`), so apply
 *     phases of self-verify tasks stay locked.
 *
 * R1/R2 — phase-blind, depends only on graph state + the error-task
 * discriminator + the pure prior-error-task reader + the verify-mode channel.
 */

import type { ArchitectGraphState } from '../../../state';
import { isErrorTask } from '../../error/model/is';
import { containsRuntimeErrorPattern } from '../../../../../../../core/utils/runtimeErrorPattern';
import { renderPriorErrorTasks } from './prompt/priorErrorTasks';
// Leaf imports (predicate.ts / markVerifyEntered.ts) — do NOT import
// `isVerifyModeActive` from composeBundle: it pulls the hook registry, and this
// module is imported by `nodes/tool/index.ts`, so that edge would risk a cycle.
import { requiresVerification } from './predicate';
import { isVerifyEntered } from './markVerifyEntered';

export function allowsPersistentProcesses(state: ArchitectGraphState): boolean {
  if (isErrorTask(state.currentTask)) return true;
  if (containsRuntimeErrorPattern(state.directive)) return true;
  if ((renderPriorErrorTasks(state)?.length ?? 0) > 0) return true;
  return requiresVerification(state.currentTask) && isVerifyEntered(state);
}
