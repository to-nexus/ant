/**
 * tasks/doc/index.ts — doc task bundle.
 *
 * Doc tasks generate README / API docs after the code they describe
 * has stabilised. They run last in the execution pipeline via the doc
 * barrier, consuming the cross-type `hasPreDocWork` gate produced by
 * setup / feature / test-code bundles.
 *
 * Hooks published:
 *   - scheduling.preDocBarrier — block doc while `blocksDoc` producers
 *                                (setup / feature / test-code) run.
 *   - conversations.convKey    — per-task conversation scope (pre-wiring;
 *                                phase layer still shares
 *                                `CONV_KEYS.NODE_EXECUTE`).
 *
 * Intentionally absent:
 *   - plan.buildPrompt / extraTemplateVars — doc flows through the
 *     shared `jobs/code/nodes/plan` path; there is no `plan/variants/
 *     doc/` template to port. The `!isDocTask(task)` entry in
 *     `planGeneration.ts taskRequiresPlan` is a skip-planning predicate
 *     on the phase side — `isDocTask` is used directly (since T6b-κ)
 *     rather than a hook, because skip-planning is a static per-type
 *     fact and no hook context is needed.
 *   - check.evaluate / noDoneSignalHint — the LLM <done> signal is
 *     sufficient for doc tasks; there is no disk-level completion gate
 *     analogous to test-code's `detectTestFilesFromDisk`, and the
 *     generic "Break down the task scope" hint is correct when the
 *     call budget is exhausted.
 *   - scheduling consumer flags `preUiBarrier / preTestgenBarrier /
 *     preIntegrationBarrier` — doc is sequenced strictly after the
 *     `blocksDoc` producers; it does not consume the ui / testgen /
 *     integration barriers.
 *   - scheduling producer flags `blocksUi / blocksTestgen / blocksDoc
 *     / blocksIntegration` — doc is a barrier sink only. In particular
 *     `blocksDoc=undefined` is a deliberate regression guard against
 *     sibling doc tasks self-blocking their own parallel scheduling.
 *
 * Phase-layer `task.type === 'doc'` residuals were resolved in T6b-κ
 * (the skip-planning gate at `nodes/plan/planGeneration.ts
 * taskRequiresPlan` now calls `isDocTask` directly).
 */

import type { TaskHooks } from '../_shared/types';

import { preDocBarrier, classify as schedulingClassify } from './hooks/scheduling';
import { convKey } from './hooks/conversations';
import { executeHook } from './hooks/execute';

export const hooks: TaskHooks = {
  scheduling: { preDocBarrier, classify: schedulingClassify },
  conversations: { convKey },
  execute: executeHook,
  plan: {
    // R1 dispatch flags — doc tasks render narrative directly via
    // execute, no plan-text body and no tool loop. Replaces the
    // `isDocTask(task)` predicate in `taskRequiresPlan`.
    requiresPlanText: false,
    usesToolLoop: false,
    // Without this, the empty-`planText` no-op sentinel in
    // `outcome/finalize.ts` would mark the doc task `done` at the plan
    // phase and short-circuit to checkTaskStatus — the docgen `executeHook`
    // (which writes README / docs) would never run. This flag tells finalize
    // the empty plan body is expected and execute must still run.
    skipPlanRunExecute: true,
  },
};

export { isDocTask } from './model/is';
