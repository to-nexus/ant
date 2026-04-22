/**
 * error/hooks/plan.ts — TaskPlanHook.buildPrompt
 *
 * Ported from the `task.type === 'error'` branch at
 * `nodes/plan/planGeneration.ts` L150~172 (T6b-β). Error tasks render against
 * `jobs/code/nodes/plan/variants/error/base` with a tech-tier-aware language
 * hint (shared with the verification variant) and the resolved basis section.
 *
 * R2 — depends only on the shared `PlanPromptCtx` contract and the
 * promptBuilder contract reached via `state.deps`. No imports from
 * `nodes/` / `routers/` / `parallel/`.
 */

import { effectiveTechTier, getTechTier } from '@ant/shared';
import type { PlanPromptCtx, PlanPromptResult } from '../../_shared/types';
import { formatCodeContext, mapLang } from '../../_shared/helpers/planPrompt';

/**
 * Compose the error-variant plan prompt. Mirrors the legacy `task.type ===
 * 'error'` block; the verification-flavoured language hints (`jobs/code/nodes/
 * plan/variants/verification/basis/techTier/{lang}/hints`) are reused here
 * because error tasks share the same tech-tier reasoning surface as diagnostic
 * cycles.
 */
export async function buildPrompt(ctx: PlanPromptCtx): Promise<PlanPromptResult> {
  const { state, task, projectCodeContext, violationsText, options, antrulesContent } = ctx;
  const promptBuilder = state.deps?.promptBuilder;
  if (!promptBuilder) {
    throw new Error('[Plan] PromptBuilder not available');
  }

  const techTier = task.techTiers?.length
    ? effectiveTechTier(task.techTiers)
    : getTechTier(state);
  const packageManager = techTier?.packageManager || state._detectedPackageManager || undefined;
  const fmtCtx = formatCodeContext(projectCodeContext);

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

  const basisSection = await promptBuilder.renderBasis(
    state.resolvedAction?.basis,
    'code',
    taskTechTiers,
  );

  const body = await promptBuilder.render('jobs/code/nodes/plan/variants/error/base', {
    taskId: task.id,
    taskName: task.name,
    taskDescription: task.description,
    directive: state.directive || '',
    projectCodeContext: fmtCtx,
    directoryTree: (projectCodeContext as any)?.directoryTree || '',
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
