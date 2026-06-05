/**
 * `_shared/verify/persistentProcessGate` — SSOT for "are persistent processes
 * (and thus the `http_request` route-verification tool) unlocked for this
 * state?".
 *
 * Mirrors the two prompt-builder computations that already decide
 * `allowPersistentProcesses` so the tool layer, the command-policy guard, and
 * the prompt all agree on one predicate (no drift):
 *   - error task                          → always
 *     (`tasks/error/hooks/plan.ts` set `allowPersistentProcesses: true`)
 *   - runtime-error-grounded verification → directive pattern OR prior error
 *     sub-tasks present (`prompt/buildPlanPrompt.ts` `hasUserRuntimeErrorContext`)
 *
 * R1/R2 — phase-blind, depends only on graph state + the error-task
 * discriminator + the pure prior-error-task reader.
 */

import type { ArchitectGraphState } from '../../../state';
import { isErrorTask } from '../../error/model/is';
import { containsRuntimeErrorPattern } from '../../../../../../../core/utils/runtimeErrorPattern';
import { renderPriorErrorTasks } from './prompt/priorErrorTasks';

export function allowsPersistentProcesses(state: ArchitectGraphState): boolean {
  if (isErrorTask(state.currentTask)) return true;
  if (containsRuntimeErrorPattern(state.directive)) return true;
  return (renderPriorErrorTasks(state)?.length ?? 0) > 0;
}
