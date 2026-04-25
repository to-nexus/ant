/**
 * `_shared/verify/initSession` — TaskPlanHook.initSession implementation
 * shared by every verification responsibility holder.
 *
 * SSOT: previously `tasks/verification/hooks/plan.ts::initSession`. Moved
 * here because every task that owns a verification cycle (verification
 * task type AND self-verify Tier 2 tasks) needs identical session
 * hydration semantics.
 *
 * Two-phase identity gate:
 *
 *   - Verification task type — fires on every plan entry (fresh /
 *     retry / reverify). The task is a dedicated verification responsibility
 *     from the moment it starts.
 *   - Self-verify Tier 2 task — fires ONLY at reverify entry. The
 *     apply phase has its own task-type-specific plan/execute; no
 *     Session is needed until the LLM emits `<done>` and the router
 *     transitions the task into verify-mode via `state._nextPlanEntry =
 *     'reverify'`.
 *
 * Side effect: marks `_verifyEntered` on first session creation /
 * hydration. Idempotent — `markVerifyEntered` no-ops when the channel
 * is already true.
 *
 * R2 — depends only on `_shared/verify/Session`, `predicate`, and the
 * graph state shape.
 */

import type { ArchitectGraphState } from '../../../state';
import type { InitSessionEnv } from '../types';
import { VerificationSession } from './Session';
import { markVerifyEntered } from './markVerifyEntered';
import { isVerificationTask } from '../../verification/model/is';

/**
 * Merge-aware VerificationSession population at plan-node entry.
 *
 *   - Missing session → constructs a fresh one via `createFresh(env)`.
 *   - Session present with an empty required-gate set (scenario seed that
 *     carried only attempts / history metadata, or an early-rehydrated
 *     pre-plan snapshot) → populates required/passed from `env` via
 *     `hydrateEnv` while preserving attempts, history, installNeeded, etc.
 *   - Session present with a populated required set → no-op (carry-over
 *     from resume/rehydrate is authoritative).
 *
 * Two-phase gate: skipped for self-verify Tier 2 tasks at fresh / retry
 * entries — these tasks run an apply-phase cycle first (task-type-specific
 * plan/execute) and only enter verify-mode at the reverify entry triggered
 * by `executeRouter.routeAfterDone`. Verification task type bypasses the
 * gate (always fires).
 *
 * Idempotency: every other carry-over boundary populates the session via
 * `_shared/verify/orchestrator.ts::restoreIntoWorkerState` and
 * `runner.ts` resume hydration; both run before the plan node fires, so
 * `initSession` never stomps a rehydrated cycle.
 *
 * Always calls `markVerifyEntered` so the channel flips the moment a
 * task gains a session.
 */
export function initSession(state: ArchitectGraphState, env: InitSessionEnv): void {
  // Self-verify task gating: apply phase MUST NOT spin up a Session.
  // The apply phase's task-type-specific plan/execute has no
  // verification semantics and would emit a malformed plan if rendered
  // through the verify-mode template. Only the reverify entry (set by
  // executeRouter.routeAfterDone routing to plan after <done>) flips
  // this task into verify-mode.
  //
  // The gate fires only when `currentTask` is set AND it is a self-verify
  // task (not verification task type) AND the entry reason is NOT
  // reverify. Direct callers (tests, scenario seeds) that pass undefined
  // currentTask fall through to the legacy unconditional init — preserving
  // backward compatibility for unit tests that exercise initSession in
  // isolation.
  const task = state.currentTask;
  if (task && !isVerificationTask(task) && state._nextPlanEntry !== 'reverify') {
    return;
  }

  if (!state.verification) {
    state.verification = VerificationSession.createFresh(env);
    markVerifyEntered(state);
    return;
  }
  state.verification.hydrateEnv(env);
  markVerifyEntered(state);
}
