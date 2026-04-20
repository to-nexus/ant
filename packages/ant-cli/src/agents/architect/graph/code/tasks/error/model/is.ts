/**
 * error/model/is.ts — `isErrorTask` predicate.
 *
 * The legacy `utils/taskClassification.ts` conflated "error" and
 * "verification" under `isVerificationTask` (via a priority / name
 * keyword fallback that also matched error tasks). T6b-η finished the
 * split:
 *
 *   - `tasks/verification/model/is.ts`   — verification discriminator
 *   - `tasks/error/model/is.ts`          — this file
 *
 * No composite predicate is published. Call sites that genuinely apply
 * to both spell `isVerificationTask(t) || isErrorTask(t)` out explicitly,
 * because the two task types diverge on session ownership (verification
 * owns a `VerificationSession`, error does not), command-guard behaviour
 * (verification runs build/test/typecheck in plan phase, error never
 * does), and plan-entry semantics (verification runs the diagnostic
 * tool-loop, error fast-paths through `prePlanText`).
 *
 * The discriminator is `task.type === 'error'`. Tasks that are merely
 * "error-adjacent" (e.g. verification tasks producing error diagnostics)
 * still return `false`.
 *
 * R2 — phase-blind.
 */

export function isErrorTask(task: { type?: string } | undefined): boolean {
  return task?.type === 'error';
}
