/**
 * explain/model/is.ts — `isExplainTask` predicate.
 *
 * Explain tasks do not yet have a full hook bundle — the registry
 * entry in `tasks/_shared/registry.ts` is still the placeholder `{}`
 * pending a future explain bundle slice. However the predicate itself
 * is required so the phase layer can retire the last
 * `task.type !== 'explain'` literal (the skip-planning gate at
 * `nodes/plan/planGeneration.ts taskRequiresPlan`).
 *
 * Introduced in T6b-κ together with `isDesignSystemTask` and
 * `isTestCodeTask` to close the final phase-layer R1 residuals
 * flagged during T5b.5 / T5b.6 / T5b.7 bundle reviews.
 *
 * R2 — phase-blind.
 */

export function isExplainTask(
  task: { type?: string } | null | undefined,
): boolean {
  return task?.type === 'explain';
}
