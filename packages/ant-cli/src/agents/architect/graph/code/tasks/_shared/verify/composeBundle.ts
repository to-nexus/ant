/**
 * `_shared/verify/composeBundle` — task-bundle composition helper.
 *
 * Combines a task type's apply-phase hooks with the shared verify-mode
 * hook surface in a single composition step. Every task type whose
 * `selfVerifyOnDone:true` Tier 2 path needs verification (error /
 * feature / ui / setup) wires its bundle through this helper instead of
 * hand-rolling phase-mode dispatch.
 *
 * SSOT: keeps verify-mode dispatch in one place. If a future regression
 * fixes a verify-mode bug, it lands here once and four bundles inherit
 * it without code duplication. Without this helper, four bundles would
 * each carry near-identical phase-mode branching code that drifts
 * silently across maintenance edits.
 *
 * Dispatch axis: `requiresVerification(task)` (predicate) +
 * `state._verifyEntered` (channel). The two together pick which side
 * runs:
 *
 *   - Apply phase  → `requiresVerification(task) && !_verifyEntered` —
 *     task's own apply-phase hooks fire (e.g. error remediation plan,
 *     feature implementation prompt, error command guard's apply-phase
 *     restrictions).
 *   - Verify phase → `requiresVerification(task) && _verifyEntered` —
 *     `_shared/verify/` hooks fire (verify-mode plan/execute/command/
 *     check/router/orchestrator/tool surface).
 *
 * Tasks whose `requiresVerification(task)` is false (e.g. Tier 3/4 non-
 * verification error tasks, plain feature/ui/setup tasks without
 * selfVerifyOnDone) pass through untouched — composeBundle returns the
 * apply-only hook surface.
 *
 * Static slots (TaskExecuteHook config, TaskSchedulingHook flags) are
 * NOT phase-mode-aware here. The phase-layer call sites that read those
 * slots dispatch verify-vs-apply based on `isVerifyEntered(state)`
 * directly:
 *
 *   - `nodes/execute/buildMessages.ts` reads `execute` slot — checks
 *     `isVerifyEntered(state)` and substitutes `verifyExecuteHook` when
 *     in verify-mode.
 *
 * R1 — phase nodes stay blind to task type; they ask through hooks.
 * R2 — depends only on sibling `_shared/verify/` modules + the bundle
 *      type definitions.
 */

import type { ArchitectGraphState } from '../../../state';
import type { CodeTask } from '../../../../../types/task';
import type {
  TaskHooks,
  TaskPlanHook,
  TaskCommandHook,
  TaskCheckHook,
  TaskRouterHook,
  TaskToolHook,
  TaskOrchestratorHook,
  PlanPromptCtx,
  PlanPromptResult,
} from '../types';
import { requiresVerification } from './predicate';
import { isVerifyEntered } from './markVerifyEntered';
import { initSession as verifyInitSession } from './initSession';
import { checkRetryTermination as verifyCheckRetryTermination } from './checkRetryTermination';
import { guard as verifyGuard } from './commandGuard';
import { evaluate as verifyEvaluate } from './checkEvaluate';
import { routeAfterDone as verifyRouteAfterDone } from './router';
import { onEvent as verifyOnEvent } from './toolHook';
import {
  attemptCount as verifyAttemptCount,
  restoreIntoWorkerState as verifyRestoreIntoWorkerState,
} from './orchestrator';

/**
 * Inputs to `composeBundle`. `apply` carries the task type's apply-phase
 * hooks (the ones it would have without verify-mode integration);
 * `taskTypeSpecific` carries phase-mode-blind slots (decompose,
 * conversations, scheduling, orchestrator.onTaskComplete) that pass
 * through unchanged.
 */
export interface ComposeBundleInput {
  /** Apply-phase hook surface for this task type. */
  apply?: {
    plan?: TaskPlanHook;
    execute?: TaskHooks['execute'];
    command?: TaskCommandHook;
    check?: TaskCheckHook;
    router?: TaskRouterHook;
    tool?: TaskToolHook;
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

// ────────────────────────────────────────────────────────────────────────
// Per-slot composers
// ────────────────────────────────────────────────────────────────────────

function composePlan(apply: TaskPlanHook | undefined): TaskPlanHook {
  return {
    initSession: (state, env) => {
      // initSession is the verify-mode dispatch entry. Apply phase has no
      // session — fired only when phase nodes call hooksForTaskType()?.
      // plan?.initSession?.() at fresh / reverify entries. We always
      // delegate to the shared verify-mode initSession, which is
      // idempotent and only flips the `_verifyEntered` channel + creates
      // the Session.
      verifyInitSession(state, env);
    },
    // `buildPrompt` and `toolLoopLogTemplate` stay apply-only here.
    // The phase layer (`nodes/plan/planGeneration.ts`) dispatches verify-
    // mode buildPrompt by checking `isVerifyEntered(state)` directly and
    // calling `_shared/verify/buildPrompt` when active. This mirrors the
    // execute-hook dispatch in `nodes/execute/buildMessages.ts` and keeps
    // the apply-mode bundle's "no buildPrompt → generic plan base path"
    // semantics intact (the wrapper would otherwise force the generic
    // path off by always returning a present-but-empty result).
    buildPrompt: apply?.buildPrompt,
    extraTemplateVars: apply?.extraTemplateVars,
    toolLoopLogTemplate: apply?.toolLoopLogTemplate,
    checkRetryTermination: (state) => {
      if (isVerifyEntered(state)) {
        return verifyCheckRetryTermination(state);
      }
      return apply?.checkRetryTermination?.(state) ?? null;
    },
  };
}

function composeCommand(apply: TaskCommandHook | undefined): TaskCommandHook {
  return {
    guard: (ctx, args) => {
      // The session being non-null is the runtime witness of verify-mode.
      // tool/index.ts copies state.verification → ctx.verificationSession,
      // and state.verification is populated only after `_shared/verify/
      // initSession` fires (which also flips `_verifyEntered`). So
      // `ctx.verificationSession` is the task-type-blind verify-mode signal
      // available to the common tool layer (which has no direct state
      // access).
      if (ctx.verificationSession) {
        return verifyGuard(ctx, args as { command: string; verifies?: any });
      }
      return apply?.guard?.(ctx, args) ?? null;
    },
  };
}

function composeCheck(apply: TaskCheckHook | undefined): TaskCheckHook {
  return {
    evaluate: async (state) => {
      if (isVerifyEntered(state)) {
        return verifyEvaluate(state);
      }
      return (await apply?.evaluate?.(state)) ?? null;
    },
    // Note: `budgetExhaustedHint` is NOT defaulted to the verify-mode hint.
    // The hint is read as a static string in `nodes/checkTaskStatus/evaluate.ts`
    // (no state context), so a verify-mode default would also fire for
    // apply-phase budget exhaustion where the generic hint is more
    // appropriate. Verification task type wires the verify hint statically
    // through its bundle shim (`tasks/verification/index.ts`); composeBundle
    // bundles forward apply's hint (typically undefined → generic fallback in
    // checkTaskStatus/evaluate).
    budgetExhaustedHint: apply?.budgetExhaustedHint,
  };
}

function composeRouter(apply: TaskRouterHook | undefined): TaskRouterHook {
  return {
    routeAfterDone: (state) => {
      // Verify-mode owns the routeAfterDone semantics. For tasks that have
      // not yet entered verify-mode but DO require verification (Tier 2
      // self-verify after apply-phase done), the router signals reverify
      // entry via the shared logic — `verifyRouteAfterDone` returns 'plan'
      // when files were applied + session not complete, which triggers
      // the reverify entry path that subsequently calls initSession.
      if (requiresVerification(state.currentTask)) {
        return verifyRouteAfterDone(state);
      }
      return apply?.routeAfterDone?.(state) ?? null;
    },
  };
}

function composeTool(apply: TaskToolHook | undefined): TaskToolHook {
  return {
    onEvent: (state, event) => {
      // Always run the verify-mode tool hook; it is a no-op when no
      // session exists (apply phase). This keeps gate flips + file-change
      // invalidations attributed correctly the moment verify-mode
      // initialises mid-task.
      verifyOnEvent(state, event);
      // Apply-phase tool side effects (e.g. command history) are owned by
      // the phase layer's generic tool hook chain in `nodes/tool/index.ts`,
      // not by per-bundle hooks. apply.onEvent stays composed for future
      // task-type-specific extensions (none today).
      apply?.onEvent?.(state, event);
    },
  };
}

function composeOrchestrator(
  applyOrchestrator: ComposeBundleInput['taskTypeSpecific'] extends infer T
    ? T extends { orchestrator?: infer O }
      ? O
      : undefined
    : undefined,
): TaskOrchestratorHook {
  return {
    // Function-shaped: returns true only for tasks that own a
    // verification cycle (Tier 3/4 verification + Tier 2 self-verify).
    // Tasks of this bundle's type that lack the verify responsibility
    // fall through to the orchestrator's shared `_failedAttempts`
    // counter as before.
    hasOwnAttemptCounter: (task) => requiresVerification(task as CodeTask),
    attemptCount: (task) => verifyAttemptCount(task as CodeTask),
    restoreIntoWorkerState: (workerState, resume) => {
      verifyRestoreIntoWorkerState(workerState, resume);
    },
    // Apply-phase orchestrator side effects (e.g. error's defense-in-depth
    // Final Verification fallback) pass through unchanged.
    onTaskComplete: applyOrchestrator?.onTaskComplete,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Entry point
// ────────────────────────────────────────────────────────────────────────

/**
 * Compose a task bundle with verify-mode dispatch baked in. Returns a
 * `TaskHooks` object suitable for `tasks/{type}/index.ts` to export as
 * `hooks`.
 *
 * @example
 * ```ts
 * // tasks/error/index.ts
 * export const hooks = composeBundle({
 *   apply: {
 *     plan: { buildPrompt: errorPlanBuildPrompt, toolLoopLogTemplate: '...' },
 *     execute: errorExecuteHook,
 *     command: { guard: errorApplyCommandGuard },
 *   },
 *   taskTypeSpecific: {
 *     decompose: { isExclusive: errorIsExclusive },
 *     conversations: { convKey },
 *     orchestrator: { onTaskComplete: errorOnTaskComplete },
 *   },
 * });
 * ```
 */
export function composeBundle(input: ComposeBundleInput): TaskHooks {
  const a = input.apply ?? {};
  const t = input.taskTypeSpecific ?? {};
  return {
    plan: composePlan(a.plan),
    execute: a.execute,
    command: composeCommand(a.command),
    check: composeCheck(a.check),
    router: composeRouter(a.router),
    tool: composeTool(a.tool),
    orchestrator: composeOrchestrator(t.orchestrator),
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
