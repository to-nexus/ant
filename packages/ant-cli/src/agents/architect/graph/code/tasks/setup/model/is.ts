/**
 * setup/model/is.ts — `isSetupTask` predicate.
 *
 * Used by the phase layer (`nodes/tool/utils/helpers.ts` task reminder,
 * `nodes/plan/index.ts` setup-specific prompt branches) to keep the
 * `task.type === 'setup'` comparison out of the blind layers (R1).
 *
 * R2 — phase-blind.
 */

export function isSetupTask(task: { type?: string } | null | undefined): boolean {
  return task?.type === 'setup';
}
