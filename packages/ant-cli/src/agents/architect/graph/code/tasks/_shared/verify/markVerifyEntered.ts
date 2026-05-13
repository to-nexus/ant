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
 * **Single writer:** `markVerifyEntered(state)`, called only from node
 * bodies whose return delta also commits `_verifyEntered:true` (mutation
 * for same-turn body reads, delta for the LangGraph reducer commit).
 *
 *   1. `nodes/plan/entry/resolve.ts::handleFreshTaskEntry` —
 *      Tier 3/4 dedicated verification task path. Fires on every fresh
 *      plan-node entry where `isVerificationTask(nextTask)` (i.e. cycle 1
 *      of the queue pop AND every subsequent Path A re-queue cycle).
 *      Replaces the retired `_shared/verify/initSession` writer that the
 *      `vast-curling-perch` cleanup deleted (commit `4673ad7f`).
 *   2. `nodes/plan/entry/resolve.ts::handleReverifyEntry` —
 *      Tier 2 self-verify task path. The apply→verify boundary and every
 *      subsequent reverify cycle. Plan-entry dispatch detects this from
 *      observable channel state (`_activePhase='execute'` + `llmResponse.done`
 *      + `requiresVerification(task) && !isVerificationTask(task)` + non-empty
 *      `planText`) and routes to `handleReverifyEntry`, which commits
 *      `delta._verifyEntered:true`. Idempotent: cycle 2+ rewrites
 *      `true → true` as a no-op under the last-write-wins reducer.
 *   3. `runner.ts::buildInitialState` (resume restoration) — mutates the
 *      **input** state object passed to `graph.invoke()`. Persists because
 *      it precedes graph execution; LangGraph hydrates channels from this
 *      input as the initial commit.
 *
 * **Reset writer:** `clearForTaskBoundary()` returns
 * `{ _verifyEntered: false }` as a delta object. Phase code spreads it
 * into the success / batch-split / pre-planned return so the next task
 * starts in apply-mode. No phase code writes `_verifyEntered: false`
 * directly.
 *
 * ⚠️ **Anti-pattern:** do not flip `_verifyEntered` from a LangGraph
 * conditional-edge function (`routeAfterX`). LangGraph reads
 * conditional-edge state fresh from channels via `ChannelRead.doRead`
 * with the `fresh` flag, so mutations made during routing are silently
 * discarded. Only node returns commit deltas. Confirmed empirically on
 * `@langchain/langgraph` 1.0.1 — the prior `executeRouter` `<done>` call
 * site was a silent no-op for the entire lifetime of every Tier-2
 * self-verify task (see job `ultra-fusing-scone` RCA).
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
 * Idempotency matters: both `handleFreshTaskEntry` (Tier 3/4) and
 * `handleReverifyEntry` (Tier 2) re-call this on every plan-entry cycle.
 * Re-flipping `true → true` is a no-op and intentional.
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
