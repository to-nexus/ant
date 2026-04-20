/**
 * doc/model/is.ts — `isDocTask` predicate.
 *
 * Kept for future phase-layer adopters that still need a task-type
 * predicate (e.g. `nodes/plan/planGeneration.ts` L232 skip-planning
 * gate, pending a future T6b slice). The execute-phase dirTree gating
 * that used to call this predicate was lifted into the `execute` hook
 * slot at T6b-ι.
 *
 * R2 — phase-blind.
 */

export function isDocTask(task: { type?: string } | null | undefined): boolean {
  return task?.type === 'doc';
}
