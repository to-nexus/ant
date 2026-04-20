/**
 * ui/model/is.ts — `isUiTask` predicate.
 *
 * Used by the phase layer (`nodes/execute/index.ts` UI-doc guardrail)
 * to keep the `task.type === 'ui'` comparison out of the blind layers (R1).
 *
 * UI tasks carry no cross-phase Session, so this `model/` only hosts a
 * predicate. Scheduling (`preUiBarrier`) and conversation (`convKey`) live
 * in `ui/hooks/`.
 *
 * R2 — phase-blind.
 */

export function isUiTask(task: { type?: string } | null | undefined): boolean {
  return task?.type === 'ui';
}
