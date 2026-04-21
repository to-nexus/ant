/**
 * tasks/design-system/index.ts — design-system task bundle.
 *
 * Design-system tasks build the visual infrastructure in the code
 * pipeline — token→CSS bridge (priority 200) and shared component
 * library (priority 201+), all sharing `parallelGroup: "design-system"`.
 * Their ordering is enforced entirely by **priority + parallelGroup**,
 * not by type-level hook flags, so this bundle is the thinnest of the
 * task-type bundles: it publishes only the conversation-key landing
 * slot.
 *
 * Hooks published:
 *   - conversations.convKey    — per-task conversation scope (pre-wiring;
 *                                phase layer still shares
 *                                `CONV_KEYS.NODE_EXECUTE`).
 *
 * Intentionally absent:
 *   - scheduling.{pre*Barrier, blocks*} — design-system's ordering is
 *     priority-based (SSOT). See `hooks/scheduling.ts` for the full
 *     argument; the short version is that (a) the `isFoundationTask`
 *     priority window 200–299 in `parallel/TaskOrchestrator.ts` already
 *     activates `hasPreFeatureWork` to gate priority ≥ 300 tasks, and
 *     (b) `parallelGroup: "design-system"` + priority-ordered assignment
 *     serialises siblings. Publishing any type-level flag would
 *     duplicate those semantics in a second place.
 *   - plan.buildPrompt / extraTemplateVars — design-system tasks DO run
 *     through the plan phase (they are not in the `taskRequiresPlan`
 *     skip list at `planGeneration.ts` L227–235), but they flow through
 *     the shared `jobs/code/nodes/plan/base` template and the generic
 *     artifact-resolution pipeline. There is no `plan/variants/
 *     design-system/` template and no planGeneration.ts branch to port.
 *   - decompose.isExclusive — design-system tasks are parallel-safe
 *     within the foundation priority tier; serialisation comes from the
 *     shared `parallelGroup`, not from type-level exclusivity.
 *   - check.evaluate / budgetExhaustedHint — the LLM <done> signal is
 *     sufficient for design-system artefact tasks; there is no
 *     disk-level completion gate analogous to test-code's
 *     `detectTestFilesFromDisk`, and the generic budget-exhausted hint
 *     is correct.
 *
 * Phase-layer `task.type === 'design-system'` predicate adoption is
 * completed at T6b-κ: `isDesignSystemTask` (re-exported below) backs
 * the `isFrontendTask` OR chain in `nodes/execute/tools.ts`
 * and the artifact-policy disjunction inside
 * `nodes/decompose/responseParser.ts deriveArtifactPolicy`. The
 * remaining residuals (`nodes/decompose/validation.ts` allowed-type
 * string array and `nodes/revise/index.ts` intermediate typed field
 * declaration) are literal enumerations rather than behavioural
 * branches — they are considered R3-equivalent and do not need
 * predicate adoption.
 */

import type { TaskHooks } from '../_shared/types';

import { convKey } from './hooks/conversations';

export const hooks: TaskHooks = {
  conversations: { convKey },
};

export { isDesignSystemTask } from './model/is';
