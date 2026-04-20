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
 *     doc/` template to port. The `task.type !== 'doc'` entry in
 *     `planGeneration.ts taskRequiresPlan` (currently L232) is a
 *     skip-planning predicate on the phase side (pre-existing R1
 *     residual, T6b follow-up) and does not translate to a hook here.
 *   - check.evaluate / budgetExhaustedHint — the LLM <done> signal is
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
 * Phase-layer `task.type === 'doc'` residuals (`nodes/plan/
 * planGeneration.ts` L232 skip-planning gate) are pre-existing R1
 * misses carried forward from T6b-δ and belong to follow-up T6b
 * cleanup — they require either an `isDocTask` adoption or a broader
 * `taskRequiresPlan` classification hook that is out of T5b.6 scope.
 * `nodes/execute/promptBuilder.ts` L675 (dirTree gating) already
 * consults `isDocTask` from this bundle.
 */

import type { TaskHooks } from '../_shared/types';

import { preDocBarrier } from './hooks/scheduling';
import { convKey } from './hooks/conversations';

export const hooks: TaskHooks = {
  scheduling: { preDocBarrier },
  conversations: { convKey },
};

export { isDocTask } from './model/is';
