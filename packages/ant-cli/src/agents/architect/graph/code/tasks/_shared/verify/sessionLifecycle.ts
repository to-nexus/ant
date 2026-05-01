/**
 * `_shared/verify/sessionLifecycle` — single SSOT for every
 * `state.verification` mutation + `_verifyEntered` channel toggle.
 *
 * Phase code (plan/execute/checkTaskStatus/batchSplit) calls these
 * functions; it does NOT call `Session` methods or `markVerifyEntered`
 * / `resetVerifyEntered` directly. Concentrating the writes here means:
 *
 *   1. Tracing (`traceSession`) is uniform — every mutation surfaces a
 *      before/after diff in the execution log.
 *   2. The "Session writer SSOT" invariant is mechanically verifiable
 *      by `rg`-ing for direct `Session` method calls outside this module.
 *   3. `_verifyEntered` reset is consolidated — `clearForTaskBoundary()`
 *      is the only delta producer phase code uses, so the previous
 *      asymmetry between `nodes/checkTaskStatus/index.ts` (returned the
 *      delta) and `nodes/checkTaskStatus/workerIndex.ts` (omitted it)
 *      cannot recur.
 *
 * R2 — depends only on sibling `_shared/verify/` modules + the graph
 * state shape.
 */

import type { ArchitectGraphState } from '../../../state';
import { traceSession } from './sessionTrace';
export { initSession } from './initSession';
export type { InitSessionEnv } from '../types';

/**
 * Reverify entry — bumps `Session.attempts`. No-op when no session
 * exists (defensive; the caller always invokes `initSession` first via
 * the plan hook so this path normally has a session).
 */
export function onReverifyEntry(state: ArchitectGraphState): void {
  const session = state.verification;
  if (!session) return;
  traceSession(state, 'onPlanEntry', () => session.onPlanEntry('reverify'), { reason: 'reverify' });
}

/**
 * Dependency-install observation cache. `installed === true` flips the
 * Session's `installNeeded` to false, `installed === false` flips it
 * to true. The codebase remains the authoritative source — this is a
 * per-entry observation cache so prompt/guard readers within a single
 * task do not walk the filesystem repeatedly.
 */
export function onInstallObserved(state: ArchitectGraphState, installed: boolean): void {
  const session = state.verification;
  if (!session) return;
  traceSession(state, 'markInstallNeeded', () => session.markInstallNeeded(!installed), {
    installed,
  });
}

/**
 * Record a plan that has been applied (past tense). Caller decides
 * whether the plan counts as "applied" — batch-split fan-out and
 * empty-impl shortcuts skip this call so the hash list stays free of
 * non-applied plans. `callSite` is logged in the trace so multiple
 * call origins (plan/index, plan/llm/toolLoop) remain distinguishable.
 */
export function onPlanApplied(
  state: ArchitectGraphState,
  planText: string,
  callSite: string,
): void {
  const session = state.verification;
  if (!session) return;
  traceSession(state, 'onPlanApplied', () => session.onPlanApplied(planText), {
    planTextLen: planText.length,
    callSite,
  });
}

/**
 * Batch-split cycle bookkeeping. Bumps both `batchSplitCount` and the
 * generic `attempts` counter so deep-diagnostic mode and the cycle
 * banner stay monotonic across split → requeue → fresh-entry chains.
 */
export function onBatchSplit(
  state: ArchitectGraphState,
  summary: {
    cycle: number;
    totalErrors: number;
    rootCauses: readonly unknown[];
    batchNames: readonly string[];
  },
): void {
  const session = state.verification;
  if (!session) return;
  const summaryJson = JSON.stringify(summary);
  traceSession(state, 'onBatchSplit', () => session.onBatchSplit(summaryJson), {
    cycle: summary.cycle,
    batchCount: summary.batchNames.length,
  });
}

/**
 * Task-boundary delta. Returned by `checkTaskStatus` (main + worker)
 * and by the prePlanned fast-path so the next task starts in
 * apply-mode with a clean session reference. The next verification
 * responsibility holder (verification task or self-verify Tier 2 task)
 * pops with a fresh `Session` via `initSession`; resumed workers
 * bypass this path and rehydrate via `orchestrator.restoreIntoWorkerState`.
 */
export function clearForTaskBoundary(): {
  verification: undefined;
  _verifyEntered: boolean;
} {
  return { verification: undefined, _verifyEntered: false };
}
