/**
 * error/model/is.ts — `isErrorTask` predicate.
 *
 * The legacy `utils/taskClassification.ts` conflated "error" and
 * "verification" under `isVerificationTask` (via a priority / name
 * keyword fallback that also matched error tasks). That conflation is
 * split in this redesign:
 *
 *   - `tasks/verification/model/is.ts`   — verification discriminator
 *   - `tasks/error/model/is.ts`          — this file
 *   - `tasks/_shared/classification.ts`  — composite `isDiagnosticTask`
 *                                          for callers that genuinely
 *                                          need "either of the two".
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
