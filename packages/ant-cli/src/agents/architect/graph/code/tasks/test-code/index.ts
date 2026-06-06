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
 *   - execute                      — skipExamples flag only (NON-forking:
 *                                    no templatePaths swap; rides the shared
 *                                    default execute template whose
 *                                    `test-code-task` / `test-code-rules`
 *                                    overlays are gated on
 *                                    `currentTask.type === 'test-code'`).
 *   - plan.extraTemplateVars       — type-specific template vars only
 *                                    (workspace-dep-snapshot, packageManager,
 *                                    languageHints) merged into the shared
 *                                    `jobs/code/nodes/plan/base` render. The
 *                                    install/observe/wire protocol lives in
 *                                    the gated `test-code-protocol` overlay;
 *                                    the split decision comes from the shared
 *                                    FAN-OUT rubric (task-split-rubric +
 *                                    plan-batch-capacity). Sub-tasks receive
 *                                    slim `prePlanText` (featureBatchShape)
 *                                    and re-author their own implementation
 *                                    via `nodes/plan/injections/parent-pre-plan`.
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
 *   - check.noDoneSignalHint — the generic "Break down the task scope"
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
import { extraTemplateVars as planExtraTemplateVars } from './hooks/plan';
import { guard as commandGuard } from './hooks/command';

// Non-forking: test-code rides the shared `jobs/code/nodes/plan/base` and
// `execute/variants/default` templates (which gate-include the
// `test-code-protocol` plan overlay + `test-code-task` / `test-code-rules`
// execute overlays, and the shared FAN-OUT / capacity rubric). The plan hook
// only contributes type-specific template vars; there is no `plan.buildPrompt`
// override and no execute `templatePaths` swap. Sub-tasks receive slim
// `prePlanText` from batch-split (featureBatchShape) and re-author their own
// implementation — see `nodes/plan/injections/parent-pre-plan.md`.
export const hooks: TaskHooks = {
  scheduling: { preTestgenBarrier, blocksDoc },
  conversations: { convKey },
  check: { evaluate },
  execute: executeHook,
  plan: {
    extraTemplateVars: planExtraTemplateVars,
  },
  command: { guard: commandGuard },
};

export { isTestCodeTask } from './model/is';
