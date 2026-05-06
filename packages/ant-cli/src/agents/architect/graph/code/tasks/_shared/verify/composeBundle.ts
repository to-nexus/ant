/**
 * `_shared/verify/composeBundle` — task-bundle composition helper.
 *
 * Combines a task type's apply-phase hooks with the shared verify-mode
 * router in a single composition step. Every task type whose
 * `selfVerifyOnDone:true` Tier 2 path needs verification (error /
 * feature / ui / setup) wires its bundle through this helper.
 *
 * Dispatch axis (post plan §5.4 / §5.6 simplification):
 *
 *   - Apply phase  → `requiresVerification(task) && !_verifyEntered` —
 *     task's own apply-phase hooks fire.
 *   - Verify phase → `requiresVerification(task) && _verifyEntered` —
 *     verify-mode plan/execute/router surface fires (selected via
 *     `activeHooks.activePlanBuildPrompt` / `activeExecuteHook`).
 *
 * Tasks whose `requiresVerification(task)` is false pass through
 * untouched — composeBundle returns the apply-only hook surface.
 *
 * R1 — phase nodes stay blind to task type; they ask through hooks.
 * R2 — depends only on sibling `_shared/verify/` modules + the bundle
 *      type definitions.
 */

import type { ArchitectGraphState } from '../../../state';
import type {
  TaskHooks,
  TaskPlanHook,
  TaskCheckHook,
  TaskRouterHook,
  TaskOrchestratorHook,
  PlanPromptCtx,
  PlanPromptResult,
} from '../types';
import { requiresVerification } from './predicate';
import { isVerifyEntered } from './markVerifyEntered';
import { routeAfterDone as verifyRouteAfterDone } from './hooks/router';
import { parityCheckEvaluate } from './parity';

/**
 * Inputs to `composeBundle`. `apply` carries the task type's apply-phase
 * hooks; `taskTypeSpecific` carries phase-mode-blind slots (decompose,
 * conversations, scheduling, orchestrator.onTaskComplete) that pass
 * through unchanged.
 */
export interface ComposeBundleInput {
  /** Apply-phase hook surface for this task type. */
  apply?: {
    plan?: TaskPlanHook;
    execute?: TaskHooks['execute'];
    command?: TaskHooks['command'];
    check?: TaskCheckHook;
    router?: TaskRouterHook;
    tool?: TaskHooks['tool'];
  };
  /** Slots not affected by verify-mode dispatch. */
  taskTypeSpecific?: {
    decompose?: TaskHooks['decompose'];
    conversations?: TaskHooks['conversations'];
    scheduling?: TaskHooks['scheduling'];
    /** Apply-phase orchestrator slots (e.g. error's onTaskComplete fallback). */
    orchestrator?: Pick<TaskOrchestratorHook, 'onTaskComplete'>;
  };
}

function composeRouter(apply: TaskRouterHook | undefined): TaskRouterHook {
  return {
    routeAfterDone: (state) => {
      // Verify-mode owns the routeAfterDone semantics for any task that
      // requires verification; apply-phase router runs otherwise.
      if (requiresVerification(state.currentTask)) {
        return verifyRouteAfterDone(state);
      }
      return apply?.routeAfterDone?.(state) ?? null;
    },
  };
}

/**
 * Compose the `check.evaluate` slot so verify-mode tasks (Tier 2 self-
 * verify with `selfVerifyOnDone:true`) inherit the Service Virtualization
 * parity check after their apply-phase check fires. Apply-phase check
 * results take precedence — parity only runs when the apply check
 * returned no violation.
 *
 * `budgetExhaustedHint` and any other static fields on the apply check
 * pass through unchanged.
 */
function composeCheck(apply: TaskCheckHook | undefined): TaskCheckHook | undefined {
  const applyEval = apply?.evaluate;
  return {
    ...apply,
    evaluate: async (state) => {
      if (applyEval) {
        const v = await applyEval(state);
        if (v) return v;
      }
      // Parity only fires in verify-mode (the helper itself short-circuits
      // when `_verifyEntered === false` AND when the virtualization
      // snapshot has no business connection). The wrapper still routes to
      // it unconditionally so behaviour stays observable and the helper
      // owns the full skip contract.
      return await parityCheckEvaluate(state);
    },
  };
}

/**
 * Compose a task bundle with verify-mode router dispatch baked in.
 * Plan / execute / command / tool / check slots pass through from the
 * apply-phase definitions; verify-mode plan prompt + execute hook are
 * resolved through `activeHooks` based on `_verifyEntered`.
 */
export function composeBundle(input: ComposeBundleInput): TaskHooks {
  const a = input.apply ?? {};
  const t = input.taskTypeSpecific ?? {};
  return {
    plan: a.plan,
    execute: a.execute,
    command: a.command,
    check: composeCheck(a.check),
    router: composeRouter(a.router),
    tool: a.tool,
    orchestrator: t.orchestrator,
    decompose: t.decompose,
    conversations: t.conversations,
    scheduling: t.scheduling,
  };
}

// Re-export for testing — the regression test asserts no caller mutates
// `_verifyEntered` outside `markVerifyEntered`/`resetVerifyEntered`.
export { isVerifyEntered, requiresVerification };

/**
 * Helper for phase-layer code that needs to check verify-mode without
 * importing `isVerifyEntered` directly. Mirrors the
 * `requiresVerification(task) && _verifyEntered` predicate pair used by
 * `executeRouter.isFinalTask` and similar Safety Net checks.
 */
export function isVerifyModeActive(state: ArchitectGraphState): boolean {
  return requiresVerification(state.currentTask) && isVerifyEntered(state);
}
