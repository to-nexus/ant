/**
 * test-code/hooks/plan.ts — TaskPlanHook.buildPrompt
 *
 * Test-code parents own two decisions in the plan phase:
 *   1. Install the test runner via `run_command` inside the tool-loop.
 *   2. Optionally feature-slice split via `<plan>.batches[]`; downstream
 *      `processDiagnosticBatchSplit` (see `BATCH_SPLIT_POLICY['test-code']`)
 *      drops the parent and spawns N parallel sub-tasks.
 *
 * R2 — no imports from `nodes/` / `routers/` / `parallel/`.
 */

import { effectiveTechTier, getTechTier } from '@ant/shared';
import type { PlanPromptCtx, PlanPromptResult } from '../../_shared/types';
import { formatCodeContext, mapLang } from '../../_shared/helpers/planPrompt';
import { workspaceDepSnapshotVars } from '../../_shared/helpers/workspaceDepSnapshotHook';

export async function buildPrompt(ctx: PlanPromptCtx): Promise<PlanPromptResult> {
  const { state, task, codeContext, violationsText, options, antrulesContent } = ctx;
  const promptBuilder = state.deps?.promptBuilder;
  if (!promptBuilder) {
    throw new Error('[Plan] PromptBuilder not available');
  }
  const depSnapshot = await workspaceDepSnapshotVars(ctx);

  const techTier = task.techTiers?.length
    ? effectiveTechTier(task.techTiers)
    : getTechTier(state);
  const packageManager = techTier?.packageManager || state._detectedPackageManager || undefined;
  const fmtCtx = formatCodeContext(codeContext);

  // Share the verification / error language-hints surface so a new test-code
  // variant doesn't force a duplicate hint tree per language. The hints are
  // framework-agnostic enough to be reused here.
  let languageHints = '';
  if (techTier?.language) {
    try {
      languageHints = await promptBuilder.render(
        `jobs/code/nodes/plan/variants/verification/basis/techTier/${mapLang(techTier.language)}/hints`,
        {},
      );
    } catch { /* no hints */ }
  }

  const taskTechTiers = task.techTiers?.length
    ? task.techTiers
    : (getTechTier(state) ? [getTechTier(state)!] : []);

  const _testCodeSlot = state.resolvedAction?.intent
    ? (await import('@ant/shared')).getConfigSlots(state.resolvedAction.intent)?.basis
    : undefined;
  const basisSection = await promptBuilder.renderBasis(
    state.resolvedAction?.basis,
    'code',
    taskTechTiers,
    state.resolvedAction?.domain,
    _testCodeSlot,
  );

  const body = await promptBuilder.render('jobs/code/nodes/plan/variants/test-code/base', {
    taskId: task.id,
    taskName: task.name,
    taskDescription: task.description,
    directive: state.directive || '',
    projectCodeContext: fmtCtx,
    directoryTree: (codeContext as any)?.directoryTree || '',
    violationsText,
    isRetry: !!violationsText,
    hasTools: options?.hasTools ?? false,
    languageHints,
    hasLanguageHints: !!languageHints,
    packageManager,
    hasPackageManager: !!packageManager,
    antrulesContent,
    resolvedAction: state.resolvedAction,
    ...depSnapshot,
  });

  const text = basisSection ? `${basisSection}\n\n---\n\n${body}` : body;
  return {
    text,
    vars: {
      hasLanguageHints: !!languageHints,
      hasPackageManager: !!packageManager,
      packageManager,
      hasViolationsText: !!violationsText,
      violationsTextLen: violationsText?.length ?? 0,
      hasWorkspaceDepSnapshot: depSnapshot.hasWorkspaceDepSnapshot,
    },
  };
}

/**
 * test-code/hooks/plan.ts — TaskPlanHook.finalizeNudge
 *
 * Issued when the plan↔tool loop exhausts its `PLAN_TOOL_LOOP_MAX` budget
 * without an emitted `<plan>` block (the LLM kept calling tools instead of
 * deciding). The default `FINALIZE_NUDGE` only says "follow the format
 * specified in the initial prompt" — for task types whose initial prompt
 * lists a single format that is enough, but test-code's initial prompt
 * lists Format A (single plan) AND Format B (`batches[]`) and asks the
 * LLM to choose. Under finalize pressure the LLM tends to default to
 * Format A even when multiple disjoint module groupings were observed
 * during exploration, which collapses parallel sub-task fan-out into a
 * single serial execution (the regression isolated in
 * `cross-item/features/base sage-blessing-pixel`).
 *
 * The override reinforces the Format-B decision rule the initial prompt
 * already encodes — without redeclaring schema or thresholds (templates
 * remain the SSOT for output schema; this nudge only restates a decision
 * principle that was already present).
 *
 * FPOP / SBS:
 *   - Principles over Examples — no directory names, language, framework,
 *     or runtime mentioned. The decision is stated in terms of "module
 *     groupings" and "test-target file sets".
 *   - Observable over Assumed — the trigger is "you observed two or more
 *     groupings whose target files do not overlap", a signal the LLM can
 *     name from the tool results above.
 *   - Constraints over Instructions — `MUST emit Format B` framing.
 *   - Reminder for Blind Spots — the trailing line names the failure mode
 *     (defaulting to A under pressure) so the LLM checks itself.
 *   - Activation gate — `taskType=test-code` ∩ finalize path. Body stays
 *     specific along that gate only; non-gate axes (stack/framework) are
 *     intentionally unaddressed (SBS-compliant).
 */
const TEST_CODE_FINALIZE_NUDGE =
  'You have finished exploring. Stop calling tools. Output exactly one `<plan>{JSON}</plan>` block.\n\n' +
  '**Constraint**: If you observed two or more module groupings whose test-target file sets do not overlap, ' +
  'you MUST emit Format B (`batches[]`) — one batch per grouping. ' +
  'Use Format A only when the total test surface is a single cohesive slice.\n\n' +
  '⚠️ **Blind spot**: Under finalize pressure the easy choice is Format A; pick Format A only when no disjoint groupings were observed.';

export function finalizeNudge(): string {
  return TEST_CODE_FINALIZE_NUDGE;
}
