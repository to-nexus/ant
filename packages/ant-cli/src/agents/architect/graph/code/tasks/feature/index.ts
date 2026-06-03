/**
 * tasks/feature/index.ts — feature task bundle.
 *
 * Feature tasks implement the primary application work (priority
 * 300–599). They run in parallel via `parallelGroup`, subject to three
 * cross-type barriers (all dispatched through the bundle's scheduling
 * hook — the orchestrator never compares raw priority bands):
 *
 *   - `hasPreFeatureWork` — shared foundation feature work
 *     (classify.isFoundation for priority 200–299) must finish before
 *     normal / integration feature tasks start. The classify function
 *     (see `hooks/scheduling.ts`) is the SSOT for this band; feature
 *     does NOT publish a static consumer flag.
 *   - `hasPreIntegrationWork` — non-integration feature tasks
 *     (classify.producesIntegrationGate for the [FEATURE_CRITICAL,
 *     INTEGRATION_MIN) band) gate integration feature tasks. The
 *     consumer side uses the static `preIntegrationBarrier` flag
 *     paired with classify.consumesIntegrationGate.
 *   - Producer barriers (`hasPreUiWork / hasPreTestgenWork /
 *     hasPreDocWork / hasPreIntegrationWork`) — feature activates
 *     these gates uniformly for every feature task via the four
 *     static `blocks*` flags below.
 *
 * Hooks published:
 *   - scheduling.preIntegrationBarrier — consumer (uniform across the
 *                                        bundle): opts feature into
 *                                        the integration barrier.
 *   - scheduling.blocksUi              — producer (uniform): ui tasks
 *                                        wait for feature work to
 *                                        finish.
 *   - scheduling.blocksTestgen         — producer (uniform): test-code
 *                                        tasks wait for feature work
 *                                        so tests see stable source.
 *   - scheduling.blocksDoc             — producer (uniform): doc tasks
 *                                        wait so docs describe the
 *                                        final shape.
 *   - scheduling.blocksIntegration     — producer (uniform): paired
 *                                        with classify's per-task
 *                                        `producesIntegrationGate`
 *                                        band so only the pre-
 *                                        integration window gates
 *                                        integration work.
 *   - scheduling.classify              — per-task band classifier
 *                                        (isFoundation /
 *                                        producesIntegrationGate /
 *                                        consumesIntegrationGate /
 *                                        expandedRagQuota). SSOT for
 *                                        "this priority band means
 *                                        scheduling role X".
 *   - decompose.isExclusive            — false for ordinary feature
 *                                        tasks; true only when
 *                                        priority === FINAL_VERIFICATION
 *                                        (defence against retyping
 *                                        regression, see
 *                                        `hooks/decompose.ts`).
 *   - conversations.convKey            — per-task conversation scope.
 *
 * Intentionally absent:
 *   - plan.buildPrompt / extraTemplateVars / toolLoopLogTemplate —
 *     feature tasks flow through the shared `jobs/code/nodes/plan/base`
 *     template and the generic artifact-resolution pipeline. There is
 *     no `plan/variants/feature/` template and no planGeneration.ts
 *     branch to port. `taskRequiresPlan` (planGeneration.ts L230–233)
 *     does NOT exclude feature, so it runs through the standard plan
 *     phase like any artifact-producing task.
 *   - check.evaluate / noDoneSignalHint — the LLM <done> signal is
 *     sufficient for feature artefact tasks; there is no disk-level
 *     completion gate analogous to test-code's
 *     `detectTestFilesFromDisk`, and the generic "break down the task
 *     scope" hint is correct when the call budget is exhausted.
 *   - tool.onEvent — feature tasks emit no session side effects from
 *     tool events; the verification Session is the only owner.
 *   - command.guard — feature tasks do not mutate a type-specific
 *     session counter on each command, unlike verification's
 *     call-budget guard.
 *   - router.routeAfterDone — feature tasks follow the default
 *     post-execute routing; only verification diverts to reverify
 *     after execute. Plan short-circuit (`llmResponse.done = true`)
 *     is owned by the plan node itself, not a router hook.
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
 * residuals were resolved in T6b-κ:
 *   - `nodes/checkTaskStatus/index.ts` L205 — `isFeatureTask`
 *     adoption (delegates the `state.featureTasks` completion marker
 *     to the predicate).
 *   - `nodes/execute/tools.ts` — `isFrontendTask`
 *     replaced by disjunction over `isUiTask / isFeatureTask /
 *     isDesignSystemTask` (new `tasks/design-system/model/is.ts`).
 *   - `nodes/decompose/responseParser.ts` fallback — the inline
 *     `(task.type || <feature-literal>)` shape is now
 *     `(task.type || DEFAULT_TASK_TYPE)`, with the constant defined in
 *     `tasks/_shared/types.ts`.
 *   - `nodes/enforce/index.ts` — same `DEFAULT_TASK_TYPE` adoption for
 *     the enforce-context fallback.
 *
 * Remaining R3-equivalent (non-behavioural, literal-enumeration) sites
 * are deliberately left as plain strings:
 *   - `nodes/revise/index.ts` L153 / L291 — inline type-field literal
 *     union in the revise-intermediate record declarations (TypeScript
 *     type-literal, not a runtime comparison).
 *   - `nodes/decompose/validation.ts` L54 — allowed-type string array
 *     used for schema validation only.
 */

import {
  preIntegrationBarrier,
  blocksUi,
  blocksTestgen,
  blocksDoc,
  blocksIntegration,
  classify as schedulingClassify,
} from './hooks/scheduling';
import { isExclusive } from './hooks/decompose';
import { convKey } from './hooks/conversations';
import { extraTemplateVars as planExtraTemplateVars } from './hooks/plan';
import { extraTemplateVars as executeExtraTemplateVars } from './hooks/execute';
import { composeBundle } from '../_shared/verify';

// Wired through `composeBundle({...})` so Tier 2 self-verify feature tasks
// (decompose-time `selfVerifyOnDone:true`) automatically pick up the
// `_shared/verify/` hook surface (Session, plan/execute/command/check/
// router/orchestrator/tool/noDoneSignalHint) once they transition into
// verify-mode via `executeRouter.routeAfterDone`. Tier 3+ feature tasks
// (no `selfVerifyOnDone`) fall through composeBundle untouched —
// `requiresVerification` returns false and apply-phase has no
// task-type-specific guard, so build/test stays the verification task's
// responsibility.
//
// `apply.plan.extraTemplateVars` publishes the workspace-dep-snapshot
// template variables so feature tasks see existing pins before they may
// introduce a sub-package manifest. The hard-reject policy in
// `manifestPinPolicy.ts` is the authoritative guard; this hook gives
// the LLM read-only visibility ahead of time, turning rejection rate
// to zero on well-behaved plans.
//
// Children of a deep-think feature parent (fan-out via
// `BATCH_SPLIT_POLICY['feature']`) receive `prePlanText` as plan-tool-loop
// INPUT (rendered via `nodes/plan/injections/parent-pre-plan.md`). The LLM
// verifies the pre-plan against actual sibling outputs (read_file /
// list_files / RAG) before emitting `planText`, then execute consumes
// `planText`. This replaces the prior identity-shortcut which masked
// sibling signature drift, causing children whose pre-plan referenced
// stale sibling exports to spin the execute toolLoop until recursion
// limit (noble-coating-lathe tweet-detail-orchestration RCA).
export const hooks = composeBundle({
  apply: {
    plan: {
      extraTemplateVars: planExtraTemplateVars,
    },
    // Pre-`<done>` contract attestation (design-conformance). Publishes
    // `requiresAttestation` for consumer feature tasks (band undefined /
    // 'integration'); foundation/platform authors are excluded inside the hook.
    // Apply-phase only — `activeExecuteHook` swaps to the verify hook in the
    // Tier-2 reverify cycle, so attest never collides with physical verify.
    execute: {
      extraTemplateVars: executeExtraTemplateVars,
    },
  },
  taskTypeSpecific: {
    scheduling: {
      preIntegrationBarrier,
      blocksUi,
      blocksTestgen,
      blocksDoc,
      blocksIntegration,
      classify: schedulingClassify,
    },
    decompose: { isExclusive },
    conversations: { convKey },
  },
});

export { isFeatureTask } from './model/is';
