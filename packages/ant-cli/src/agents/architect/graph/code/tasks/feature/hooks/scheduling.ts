/**
 * feature/hooks/scheduling.ts — TaskSchedulingHook
 *
 * Consumer flag (feature task is BLOCKED by which barrier):
 *   - preIntegrationBarrier — integration-priority feature tasks wait for
 *     all non-integration feature work to finish before they can wire
 *     components together. The priority window check
 *     (`task.priority >= TASK_PRIORITIES.INTEGRATION_MIN`) stays inline
 *     in `TaskOrchestrator` because it's cross-type; this flag simply
 *     opts `feature` into the gate.
 *
 * Producer flags (feature work ACTIVATES these barriers for other types):
 *   - blocksUi           — ui tasks wait for feature work to finish
 *                          (UI needs layout/data scaffolding to exist).
 *   - blocksTestgen      — test-code tasks wait for feature work to
 *                          finish so the tests see stable source.
 *   - blocksDoc          — doc tasks wait for feature work to finish so
 *                          the docs describe the final shape.
 *   - blocksIntegration  — non-integration feature work gates
 *                          integration-priority work (paired with the
 *                          priority window check in the orchestrator).
 *
 * Replaces the module-level predicates `isFeatureOrSetupTask`,
 * `isPreDocTask`, and `isNonIntegrationFeatureTask` that previously
 * compared `task.type` inline in `parallel/TaskOrchestrator.ts` (T6b-ε).
 */

export const preIntegrationBarrier = true;

export const blocksUi = true;
export const blocksTestgen = true;
export const blocksDoc = true;
export const blocksIntegration = true;
