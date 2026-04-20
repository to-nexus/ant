/**
 * doc/model/is.ts — `isDocTask` predicate.
 *
 * Used by the phase layer (`nodes/execute/promptBuilder.ts` dirTree gating)
 * to keep the `task.type === 'doc'` comparison out of the blind layers (R1).
 *
 * R2 — phase-blind.
 */

export function isDocTask(task: { type?: string } | null | undefined): boolean {
  return task?.type === 'doc';
}
