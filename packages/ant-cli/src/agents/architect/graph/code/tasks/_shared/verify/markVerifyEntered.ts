/**
 * `_verifyEntered` channel — single-writer helper.
 *
 * The `state._verifyEntered` channel signals "this task has entered its
 * verification phase and the shared/verify hook surface is now active".
 * It is read by:
 *
 *   - `composeBundle` — gates apply-vs-verify hook dispatch
 *   - `executeRouter.isFinalTask` predicate (Safety Net A/B/E)
 *   - `_shared/verify/prompt/buildPlanPrompt` and friends (only fire when
 *     verify-mode is active)
 *   - `nodes/plan/shortcut/{prePlanned,resumeInterrupted}` regression
 *     guards (skip-plan fast paths bail when `isVerifyModeActive(state)`
 *     is true so verification always re-runs gates).
 *
 * **Single writer:** `markVerifyEntered(state)`. Set call sites, all
 * outside this module proper but each living in a node owning its task
 * lifecycle hand-off:
 *
 *   1. `nodes/plan/entry/resolve.ts::handleFreshTaskEntry` —
 *      Tier 3/4 dedicated verification task path. Fires on every fresh
 *      plan-node entry where `isVerificationTask(nextTask)` (i.e. cycle 1
 *      of the queue pop AND every subsequent Path A re-queue cycle).
 *      Replaces the retired `_shared/verify/initSession` writer that the
 *      `vast-curling-perch` cleanup deleted; the cleanup commit
 *      `4673ad7f` removed `initSession.ts` without replacing the
 *      `markVerifyEntered` call site, leaving every dedicated
 *      verification task running with `_verifyEntered=false` for its
 *      entire lifetime — a silent functional drift.
 *   2. `routers/executeRouter` `<done>` arm — Tier 2 self-verify task
 *      path. When the apply phase emits `<done>` and
 *      `requiresVerification(task)` is true, the router calls this
 *      helper just before routing to plan (reverify entry). The next
 *      plan node entry sees `_verifyEntered` and dispatches the
 *      verify-mode hooks.
 *
 * **Reset writer:** `clearForTaskBoundary()` returns
 * `{ _verifyEntered: false }` as a delta object. Phase code spreads it
 * into the success / batch-split / pre-planned return so the next task
 * starts in apply-mode. No phase code writes `_verifyEntered: false`
 * directly.
 *
 * R2 — depends only on the graph state shape; no `nodes/` / `routers/` /
 * `parallel/` imports.
 */

import type { ArchitectGraphState } from '../../../state';

/**
 * Idempotent. Marks the active task as having entered its verification
 * phase. Subsequent `composeBundle` dispatches read this flag and route
 * plan/execute/command hooks through `_shared/verify/` instead of the
 * task's apply-phase hooks.
 *
 * Idempotency matters: verification task path calls this every fresh
 * plan entry (initSession is idempotent), and a future re-entry through
 * checkTaskStatus/retry path would call it again. Re-flipping `true →
 * true` is a no-op and intentional.
 */
export function markVerifyEntered(state: ArchitectGraphState): void {
  if (state._verifyEntered === true) return;
  state._verifyEntered = true;
}

/**
 * Read accessor. Mirrors the channel default (`false`) so callers can
 * use boolean `&&` without nullish guards. Centralising the read keeps
 * the channel shape changes (e.g. tri-state extension) confined to this
 * module.
 */
export function isVerifyEntered(state: ArchitectGraphState): boolean {
  return state._verifyEntered === true;
}

/**
 * Reset to apply-mode. Used at task-boundary cleanup
 * (`nodes/checkTaskStatus/index.ts`) so the next task starts in
 * apply-mode regardless of whether the previous task entered verify.
 */
export function resetVerifyEntered(state: ArchitectGraphState): void {
  state._verifyEntered = false;
}

/**
 * Task-boundary delta. Returned by `checkTaskStatus` (main + worker) and
 * by the prePlanned fast-path so the next task starts in apply-mode.
 */
export function clearForTaskBoundary(): { _verifyEntered: boolean } {
  return { _verifyEntered: false };
}
