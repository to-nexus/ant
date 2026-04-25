/**
 * test-code/hooks/plan.ts — TaskPlanHook.buildPrompt
 *
 * Test-code parents own two decisions in the plan phase that no other
 * task type handles:
 *
 *   1. Install the test runner (vitest / jest / pytest / go test / ...)
 *      plus any type packages via `run_command`. The planExplore tool
 *      set includes `run_command` and no guard blocks install verbs for
 *      parent test-code tasks, so this happens inside the tool-loop.
 *
 *   2. Decide whether to feature-slice split the test work. When a
 *      `batches[]` array is emitted inside the `<plan>` JSON, the
 *      downstream `processDiagnosticBatchSplit` drops the parent and
 *      spawns N parallel sub-tasks (see `BATCH_SPLIT_POLICY['test-code']`
 *      in `nodes/plan/parts/batchSplit.ts`). When the parent decides the
 *      work fits a single execution it simply emits a non-batched plan
 *      and falls through to its own execute phase.
 *
 * The prompt variant (`jobs/code/nodes/plan/variants/test-code/base.md`)
 * encodes both decisions. This hook wires the template variables and
 * pulls in the basis section exactly like verification / error variants
 * do so the basis-renderer stays untouched.
 *
 * R2 — depends only on the shared `PlanPromptCtx` contract and the
 * promptBuilder via `state.deps`. No imports from `nodes/` / `routers/`
 * / `parallel/`.
 */

import { effectiveTechTier, getTechTier } from '@ant/shared';
import type { PlanPromptCtx, PlanPromptResult } from '../../_shared/types';
import { formatCodeContext, mapLang } from '../../_shared/helpers/planPrompt';

export async function buildPrompt(ctx: PlanPromptCtx): Promise<PlanPromptResult> {
  const { state, task, codeContext, violationsText, options, antrulesContent } = ctx;
  const promptBuilder = state.deps?.promptBuilder;
  if (!promptBuilder) {
    throw new Error('[Plan] PromptBuilder not available');
  }

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
    },
  };
}
