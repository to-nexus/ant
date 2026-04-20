/**
 * tasks/test-code/index.ts — test-code task bundle.
 *
 * Test-code tasks generate unit / integration tests after the feature
 * work has stabilised. They carry a testgen barrier (no test-code
 * scheduling while feature/setup work remains) and a completion guard
 * (LLM can't claim done without files actually being on disk).
 *
 * Hooks published:
 *   - scheduling.preTestgenBarrier — block test-code while `blocksTestgen`
 *                                    producers (setup / feature) run.
 *   - scheduling.blocksDoc         — running test-code work activates the
 *                                    doc barrier so docs describe the
 *                                    final test layout alongside source.
 *   - conversations.convKey        — per-task conversation scope (pre-wiring;
 *                                    phase layer still shares
 *                                    `CONV_KEYS.NODE_EXECUTE`).
 *   - check.evaluate               — async disk scan for real test files
 *                                    via `detectTestFilesFromDisk`.
 *
 * Intentionally absent:
 *   - plan.buildPrompt / extraTemplateVars — test-code flows through the
 *     shared `jobs/code/nodes/plan` path; there is no `plan/variants/
 *     test-code/` template and no planGeneration.ts branch to port. The
 *     `task.type !== 'test-code'` guard in `planGeneration.ts` that
 *     skips planning for this type is a predicate on the phase side
 *     (pre-existing R1 residual, T6b follow-up) and does not translate
 *     to a hook here.
 *   - check.budgetExhaustedHint — the generic "Break down the task scope"
 *     hint is correct for test-code; only verification overrides.
 *   - scheduling consumer flags `preUiBarrier / preDocBarrier /
 *     preIntegrationBarrier` — test-code only consumes the testgen
 *     barrier.
 *   - scheduling producer flags `blocksUi / blocksTestgen /
 *     blocksIntegration` — test-code only activates the doc barrier.
 *
 * Execute-phase R1 residuals resolved by T6b-ι (`execute` hook slot:
 * template-variant + skipExamples). Remaining R1 residuals live in
 * `nodes/plan/planGeneration.ts` L231 (skip-planning gate) and
 * `nodes/decompose/validation.ts` L55 (allowed-types list); those
 * require either an `isTestCodeTask` predicate or a broader
 * classification hook that is out of T6b-ι scope.
 */

import type { TaskHooks } from '../_shared/types';

import { preTestgenBarrier, blocksDoc } from './hooks/scheduling';
import { convKey } from './hooks/conversations';
import { evaluate } from './hooks/check';
import { executeHook } from './hooks/execute';

export const hooks: TaskHooks = {
  scheduling: { preTestgenBarrier, blocksDoc },
  conversations: { convKey },
  check: { evaluate },
  execute: executeHook,
};
