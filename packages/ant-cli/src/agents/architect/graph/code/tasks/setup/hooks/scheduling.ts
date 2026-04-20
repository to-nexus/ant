/**
 * setup/hooks/scheduling.ts — TaskSchedulingHook
 *
 * Setup tasks are foundation work (install deps, scaffold configs) and
 * therefore BLOCK downstream work of several types:
 *
 *   - blocksUi      — UI tasks can't render until setup leaves a stable
 *                     workspace / package manifest.
 *   - blocksTestgen — test-code tasks can't target a codebase whose
 *                     test runner config is still being scaffolded.
 *   - blocksDoc     — doc tasks describe the final project layout;
 *                     they wait for setup to finish so the docs are
 *                     accurate.
 *
 * Setup tasks do NOT consume any barrier themselves — they run first,
 * gated only by the priority-based `hasPreFeatureWork` check which is
 * handled inline in the orchestrator (cross-type, priority-driven).
 *
 * Introduced in T6b-ε to replace the `task.type === 'setup'` reference
 * inside `isFeatureOrSetupTask` / `isPreDocTask` module-level predicates
 * in `parallel/TaskOrchestrator.ts`.
 */

export const blocksUi = true;
export const blocksTestgen = true;
export const blocksDoc = true;
