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
 *   - execute                      — test-code-specific execute template
 *                                    variant and skipExamples flag.
 *   - plan.buildPrompt             — test-code-variant plan prompt that
 *                                    owns the two decisions unique to
 *                                    test-code parents (install test
 *                                    runner deps, decide feature-slice
 *                                    batch-split). Sub-tasks (with
 *                                    `prePlanText` set) fast-path past
 *                                    the plan phase via
 *                                    `maybePrePlannedFastPath`.
 *   - command.guard                — lockfile-race defence: reject install
 *                                    commands issued by batch-split sub-
 *                                    tasks. Parent test-code tasks (no
 *                                    `prePlanText`) are untouched because
 *                                    their plan tool-loop legitimately
 *                                    installs the runner before emitting
 *                                    `batches[]`.
 *
 * Test-code flows through the standard `jobs/code/nodes/plan` path
 * (keyword / RAG / planGen) like feature / ui / design-system tasks —
 * the earlier "skip plan for test-code" branch (a phase-layer R1
 * residual) was removed in F2 (2026-04). Planning lets test authoring
 * observe existing sources and manifest before deciding runner, and
 * surfaces retry violations back through `composeViolationsText`.
 *
 * Intentionally absent:
 *   - check.budgetExhaustedHint — the generic "Break down the task scope"
 *     hint is correct for test-code; only verification overrides.
 *   - scheduling consumer flags `preUiBarrier / preDocBarrier /
 *     preIntegrationBarrier` — test-code only consumes the testgen
 *     barrier.
 *   - scheduling producer flags `blocksUi / blocksTestgen /
 *     blocksIntegration` — test-code only activates the doc barrier.
 *     In particular `blocksTestgen=false` lets sub-tasks from a batch-split
 *     run in parallel without self-blocking.
 */

import type { TaskHooks } from '../_shared/types';

import { preTestgenBarrier, blocksDoc } from './hooks/scheduling';
import { convKey } from './hooks/conversations';
import { evaluate } from './hooks/check';
import { executeHook } from './hooks/execute';
import { buildPrompt as planBuildPrompt } from './hooks/plan';
import { guard as commandGuard } from './hooks/command';

export const hooks: TaskHooks = {
  scheduling: { preTestgenBarrier, blocksDoc },
  conversations: { convKey },
  check: { evaluate },
  execute: executeHook,
  plan: {
    buildPrompt: planBuildPrompt,
    toolLoopLogTemplate: 'jobs/code/nodes/plan/variants/test-code/base',
  },
  command: { guard: commandGuard },
};

export { isTestCodeTask } from './model/is';
