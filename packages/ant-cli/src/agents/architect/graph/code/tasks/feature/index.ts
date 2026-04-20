/**
 * tasks/feature/index.ts — feature task bundle.
 *
 * Feature tasks implement the primary application work (priority
 * 300–599). They run in parallel via `parallelGroup`, subject to three
 * cross-type barriers:
 *
 *   - `hasPreFeatureWork` — foundation work (setup / design-system,
 *     priority 200–299) must finish first. Cross-type and owned by the
 *     orchestrator's priority-window predicate `isFoundationTask`, so
 *     feature does NOT publish a type-level consumer flag for it.
 *   - `hasPreIntegrationWork` — non-integration feature tasks gate
 *     integration-priority feature tasks (priority ≥ INTEGRATION_MIN,
 *     600). The type gate is opt-in via `preIntegrationBarrier`; the
 *     priority window stays inline in the orchestrator because it is
 *     cross-type / priority-driven.
 *   - Producer barriers (`hasPreUiWork / hasPreTestgenWork /
 *     hasPreDocWork / hasPreIntegrationWork`) — feature is the primary
 *     activator of these gates for ui / test-code / doc / integration
 *     tasks, hence the four `blocks*` producer flags below.
 *
 * Hooks published:
 *   - scheduling.preIntegrationBarrier — consumer: gate integration-
 *                                        priority feature tasks behind
 *                                        other feature work (paired
 *                                        with the orchestrator's
 *                                        priority-window check).
 *   - scheduling.blocksUi              — producer: ui tasks wait for
 *                                        feature work to finish
 *                                        (layout/data scaffolding must
 *                                        exist before rendering).
 *   - scheduling.blocksTestgen         — producer: test-code tasks
 *                                        wait for feature work so the
 *                                        generated tests see stable
 *                                        source files.
 *   - scheduling.blocksDoc             — producer: doc tasks wait for
 *                                        feature work so the docs
 *                                        describe the final shape.
 *   - scheduling.blocksIntegration     — producer: non-integration
 *                                        feature tasks gate
 *                                        integration-priority work
 *                                        (paired with the orchestrator
 *                                        priority-window check — only
 *                                        priority ∈ [FEATURE_CRITICAL,
 *                                        INTEGRATION_MIN) participates).
 *   - decompose.isExclusive            — returns `false` for ordinary
 *                                        feature tasks; `true` only
 *                                        when `priority === 1000`
 *                                        (regression guard against
 *                                        retyping skip, see
 *                                        `hooks/decompose.ts`).
 *   - conversations.convKey            — per-task conversation scope
 *                                        (pre-wiring; phase layer
 *                                        still shares
 *                                        `CONV_KEYS.NODE_EXECUTE`).
 *
 * Intentionally absent:
 *   - plan.buildPrompt / extraTemplateVars / toolLoopLogTemplate —
 *     feature tasks flow through the shared `jobs/code/nodes/plan/base`
 *     template and the generic artifact-resolution pipeline. There is
 *     no `plan/variants/feature/` template and no planGeneration.ts
 *     branch to port. `taskRequiresPlan` (planGeneration.ts L230–233)
 *     does NOT exclude feature, so it runs through the standard plan
 *     phase like any artifact-producing task.
 *   - check.evaluate / budgetExhaustedHint — the LLM <done> signal is
 *     sufficient for feature artefact tasks; there is no disk-level
 *     completion gate analogous to test-code's
 *     `detectTestFilesFromDisk`, and the generic "break down the task
 *     scope" hint is correct when the call budget is exhausted.
 *   - tool.onEvent — feature tasks emit no session side effects from
 *     tool events; the verification Session is the only owner.
 *   - command.guard — feature tasks do not mutate a type-specific
 *     session counter on each command, unlike verification's
 *     call-budget guard.
 *   - router.shortCircuitAfterPlan / routeAfterDone — feature tasks
 *     follow the default post-plan / post-execute routing; only
 *     verification short-circuits after plan (reverify) and after
 *     execute (checkTaskStatus fast path).
 *   - orchestrator.* — feature tasks have no type-specific attempt
 *     counter (`hasOwnAttemptCounter === undefined` → the orchestrator
 *     falls back to its shared `_failedAttempts`), no capture-on-
 *     failure snapshot, no restoreIntoWorkerState, and no
 *     `onTaskComplete` side effect. In particular, the `featureTasks`
 *     map mutation at `nodes/checkTaskStatus/index.ts` L205 is a
 *     phase-layer R1 residual (see below), NOT an orchestrator hook.
 *   - scheduling consumer flags `preTestgenBarrier / preDocBarrier /
 *     preUiBarrier` — feature PRODUCES those barriers (see `blocks*`
 *     above); it must not also consume them, or sibling feature tasks
 *     would block each other. Regression guard: the test file locks
 *     each of these to `undefined`.
 *
 * Phase-layer `task.type === 'feature'` / `'feature'` literal
 * residuals (pre-existing R1 misses carried forward from T6b-δ,
 * belonging to follow-up T6b cleanup):
 *   - `nodes/checkTaskStatus/index.ts` L205 — `completedTask.type ===
 *     'feature'` gating the `state.featureTasks` completion marker.
 *     Candidate for `isFeatureTask` adoption.
 *   - `nodes/execute/toolDefinitions.ts` L51 — `isFrontendTask` OR
 *     chain (`'ui' | 'feature' | 'design-system'`). Needs either
 *     `isFeatureTask` + `isUiTask` + `isDesignSystemTask` adoption or
 *     a shared `isFrontendTask` classification hook.
 *   - `nodes/revise/index.ts` L153 / L291 — inline type-field literal
 *     union in the revise intermediate record declarations.
 *   - `nodes/decompose/validation.ts` L54 — allowed-type string array
 *     in the generic decompose validator.
 *   - `nodes/decompose/responseParser.ts` L395 — `(task.type ||
 *     'feature')` fallback inside `createTaskQueue`. Stays a string
 *     literal until a `defaultTaskType` constant or classification
 *     hook replaces it.
 *   - `nodes/enforce/index.ts` L94 — `state.currentTask?.type ||
 *     'feature'` fallback for the enforce payload.
 *
 * These require either an `isFeatureTask` predicate adoption (the
 * `tasks/feature/model/is.ts` predicate already exists and is used at
 * `responseParser.ts` / `sessionManager.ts`) or broader classification
 * hooks; both are out of T5b.7 scope and scheduled for the T6b
 * follow-up together with the remaining non-feature residuals.
 */

import type { TaskHooks } from '../_shared/types';

import {
  preIntegrationBarrier,
  blocksUi,
  blocksTestgen,
  blocksDoc,
  blocksIntegration,
} from './hooks/scheduling';
import { isExclusive } from './hooks/decompose';
import { convKey } from './hooks/conversations';

export const hooks: TaskHooks = {
  scheduling: {
    preIntegrationBarrier,
    blocksUi,
    blocksTestgen,
    blocksDoc,
    blocksIntegration,
  },
  decompose: { isExclusive },
  conversations: { convKey },
};

export { isFeatureTask } from './model/is';
