/**
 * Verification responsibility predicate — `requiresVerification(task)`.
 *
 * SSOT for the question "does this task own a verification cycle?".
 * Two paths qualify:
 *
 *   1. Verification task type — Tier 3/4 dedicated verification task
 *      (priority 1000) classified by `isVerificationTask`.
 *   2. Self-verify task — Tier 2 single task with `selfVerifyOnDone:true`
 *      (error / feature / ui / setup whose decompose flag opted in).
 *
 * Phase nodes, routers, and `composeBundle` dispatch on this predicate
 * instead of hard-coding `task.type === 'verification'`. The result: a
 * single behavioural axis governs verification gating regardless of which
 * task type currently owns the responsibility.
 *
 * R1 — phase code stays blind to task type. The phase layer asks "does this
 * task require verification?" through this predicate; the answer dispatches
 * the entire shared/verify hook surface.
 *
 * R2 — model-only. Imports only from sibling `_shared/verify/` modules and
 * the verification task type's identifier (`isVerificationTask`).
 */

import { isVerificationTask } from '../../verification/model/is';

/** Minimal shape needed; matches `TaskClassifyLike` from `verification/model/is`. */
interface TaskShape {
  type?: string;
  priority?: number;
  selfVerifyOnDone?: boolean;
  name?: string;
}

/**
 * True when this task owns a verification cycle (will run gates and
 * complete only when `Session.isComplete()` is satisfied). Drives every
 * dispatch in `composeBundle` and the phase-layer predicate
 * generalisations.
 *
 * Two qualifying paths:
 *   - `isVerificationTask(task)` — Tier 3/4 dedicated verification task
 *     (priority >= FINAL_VERIFICATION).
 *   - `task.selfVerifyOnDone === true` — Tier 2 single task that owns
 *     inline self-verify (decompose-time SSOT in
 *     `nodes/decompose/responseParser.ts`).
 *
 * Note: `selfVerifyOnDone` is the decompose-time flag. After the task
 * enters verify-mode (`state._verifyEntered === true`), behaviour
 * matches verification task type exactly. `composeBundle` uses the
 * `_verifyEntered` channel to gate apply-vs-verify dispatch within the
 * task's lifetime; this predicate is the type-level qualifier.
 */
export function requiresVerification(task: TaskShape | null | undefined): boolean {
  if (!task) return false;
  if (isVerificationTask(task)) return true;
  return task.selfVerifyOnDone === true;
}
