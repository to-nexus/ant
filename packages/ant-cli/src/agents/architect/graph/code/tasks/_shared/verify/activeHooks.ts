/**
 * `_shared/verify/activeHooks` — phase-mode hook resolvers.
 *
 * Phase nodes (`nodes/plan/planGeneration.ts`,
 * `nodes/execute/buildMessages.ts`) call these helpers to retrieve the
 * currently-active execute hook / plan-prompt builder. The resolvers
 * encapsulate the verify-mode dispatch so phase code never reads
 * `isVerifyEntered` directly.
 *
 * Why a separate module from `composeBundle.ts`?
 *
 *   - `composeBundle` is consumed by every task bundle index
 *     (`tasks/error/index.ts`, etc.) which in turn populates
 *     `tasks/_shared/registry.ts`. Importing `registry` from
 *     `composeBundle` would create a cycle (registry → bundle →
 *     composeBundle → registry) that returns `undefined` for the
 *     `composeBundle` symbol the bundle is trying to call.
 *
 *   - This file imports `registry` but is consumed exclusively by phase
 *     nodes (after the bundle / registry initialisation completes).
 *     There is no cycle.
 *
 * R2 — depends only on `_shared/`-layer modules and the graph state shape.
 */

import type { ArchitectGraphState } from '../../../state';
import type { TaskExecuteHook, TaskPlanHook } from '../types';
import { hooksIfActive } from '../registry';
import { isVerifyEntered } from './markVerifyEntered';
import { executeHook as verifyExecuteHook } from './executeHook';
import { buildPrompt as verifyBuildPrompt } from './buildPlanPrompt';

/**
 * Phase-mode execute hook resolver. Returns the verify-mode shared hook
 * when the task has entered verify-mode (`_verifyEntered === true`),
 * the bundle's apply-phase static hook (if published) otherwise, or
 * `undefined` to let the phase fall back to the generic execute
 * defaults. `nodes/execute/buildMessages.ts` calls this and never reads
 * `isVerifyEntered` directly.
 *
 * `TaskExecuteHook` is a static configuration object (templates,
 * skipExamples, runtimePlanFraming, …) rather than a callable, so this
 * resolver is the closest analogue to `composeBundle`'s function-shaped
 * dispatch. It guarantees the verify-mode hook is the single
 * substitution point — there is no second place where a phase might
 * still consult an apply-phase hook while in verify-mode.
 */
export function activeExecuteHook(state: ArchitectGraphState): TaskExecuteHook | undefined {
  if (isVerifyEntered(state)) return verifyExecuteHook;
  return hooksIfActive(state)?.execute;
}

/**
 * Phase-mode plan-prompt builder resolver. Returns the verify-mode
 * shared `buildPrompt` when the task has entered verify-mode, the
 * bundle's apply-phase `buildPrompt` (if published — currently only
 * the error variant) otherwise, or `undefined` to signal "fall through
 * to the generic plan base path". `nodes/plan/planGeneration.ts`
 * consumes this and never reads `isVerifyEntered` directly.
 */
export function activePlanBuildPrompt(
  state: ArchitectGraphState,
): TaskPlanHook['buildPrompt'] | undefined {
  if (isVerifyEntered(state)) return verifyBuildPrompt;
  return hooksIfActive(state)?.plan?.buildPrompt;
}
