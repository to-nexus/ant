/**
 * seam/model/is.ts — `isSeamTask` predicate.
 *
 * Seam tasks own cross-feature reference + affordance CLOSURE for one module /
 * package, run AFTER all authoring (feature + ui) over the materialized graph.
 * Their essence is closure (resolve-or-remove), not authoring — the same family
 * as verification / error, hence a dedicated TaskType rather than a feature band.
 *
 * The discriminator is `task.type === 'seam'`. R2 — phase-blind.
 */

export function isSeamTask(task: { type?: string } | undefined): boolean {
  return task?.type === 'seam';
}
