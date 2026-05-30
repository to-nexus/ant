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
import { workspaceDepSnapshotVars } from '../../_shared/helpers/workspaceDepSnapshotHook';
import { AutoInjectionResolver } from '../../../../../../../core/prompt/builder/AutoInjectionResolver';
import { TEMPLATE_PATHS } from '../../../../../../../core/prompt/builder/templatePaths';

/**
 * Compose the error-variant plan prompt. Mirrors the legacy `task.type ===
 * 'error'` block; the verification-flavoured language hints (`jobs/code/nodes/
 * plan/variants/verification/basis/techTier/{lang}/hints`) are reused here
 * because error tasks share the same tech-tier reasoning surface as diagnostic
 * cycles.
 */
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
  const { hasFrontend, hasBackend } = AutoInjectionResolver.computeStackFlags(taskTechTiers);

  const _errorPlanSlot = state.resolvedAction?.intent
    ? (await import('@ant/shared')).getConfigSlots(state.resolvedAction.intent)?.basis
    : undefined;
  const basisSection = await promptBuilder.renderBasis(
    state.resolvedAction?.basis,
    'code',
    taskTechTiers,
    state.resolvedAction?.domain,
    _errorPlanSlot,
  );

  const depSnapshot = await workspaceDepSnapshotVars(ctx);

  const body = await promptBuilder.render(TEMPLATE_PATHS.codePlanError.base, {
    taskId: task.id,
    taskName: task.name,
    taskDescription: task.description,
    directive: state.directive || '',
    // See `nodes/plan/llm/prompt.ts` — same response-language SSOT plumbing.
    userLanguage: state.context?.userLanguage || 'en',
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
    hasFrontend,
    hasBackend,
    // Error tasks always operate on a user-reported failure scenario;
    // the persistent-process partial unlocks reproducer commands here.
    allowPersistentProcesses: true,
    // Tier 3 cross-task analysis brief (sealed by Decompose). Wired
    // identically to the generic `buildPlanPrompt` (`plan/llm/prompt.ts`)
    // so error tasks see the same job-level intent as feature/setup/ui.
    analysis: state.analysis ?? '',
    hasAnalysis: !!state.analysis,
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
