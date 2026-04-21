/**
 * design-system/model/is.ts — `isDesignSystemTask` predicate.
 *
 * Introduced in T6b-κ to retire the `taskType === 'design-system'`
 * literal comparisons still residing in the phase layer (notably the
 * `isFrontendTask` OR chain in `nodes/execute/tools.ts` and
 * the artifact-policy guard in `nodes/decompose/responseParser.ts`).
 *
 * Design-system tasks carry no cross-phase Session, so this `model/`
 * only hosts a predicate. Scheduling for this task type is purely
 * priority- and parallelGroup-driven and continues to live in
 * `parallel/TaskOrchestrator.ts`; there is no scheduling hook.
 *
 * R2 — phase-blind. Depends only on the `type` shape.
 */

export function isDesignSystemTask(
  task: { type?: string } | null | undefined,
): boolean {
  return task?.type === 'design-system';
}
