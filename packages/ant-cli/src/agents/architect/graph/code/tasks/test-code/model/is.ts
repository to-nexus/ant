/**
 * test-code/model/is.ts — `isTestCodeTask` predicate.
 *
 * Introduced in T6b-κ so `nodes/plan/planGeneration.ts taskRequiresPlan`
 * (the skip-planning gate) can delegate to a per-task predicate
 * disjunction instead of keeping a `task.type !== 'test-code'` literal
 * in the phase layer.
 *
 * Test-code tasks own scheduling (`preTestgenBarrier`, `blocksDoc`),
 * a `check.evaluate` disk-scan guard, and an `execute` variant hook,
 * but no cross-phase Session. This module only hosts the predicate;
 * session-style state is not needed.
 *
 * R2 — phase-blind.
 */

export function isTestCodeTask(
  task: { type?: string } | null | undefined,
): boolean {
  return task?.type === 'test-code';
}
