/**
 * setup/hooks/plan.ts — TaskPlanHook.extraTemplateVars
 *
 * Ported from the `task.type === 'setup'` branch at
 * `nodes/plan/planGeneration.ts` L204 (T6b-β). Setup tasks mostly follow
 * the generic `jobs/code/nodes/plan/base` template, but they contribute
 * one extra slot — `setupConstraints` — rendered from the execute-phase
 * tech-tier constraint partial (`jobs/code/nodes/execute/basis/techTier/
 * {lang}/setup/constraints`). Using `extraTemplateVars` instead of a full
 * `buildPrompt` override keeps the generic artifact-resolution / RAC
 * document pipeline intact for setup tasks.
 *
 * R2 — depends only on `PlanPromptCtx` + the promptBuilder contract.
 */

import { effectiveTechTier, getTechTier } from '@ant/shared';
import type { PlanPromptCtx } from '../../_shared/types';

function mapLang(language: string): string {
  const l = language.toLowerCase();
  if (l.includes('go')) return 'go';
  if (l.includes('python')) return 'python';
  if (l.includes('rust')) return 'rust';
  if (l.includes('java')) return 'java';
  return 'typescript';
}

/**
 * Resolve the tech-tier setup-constraints partial for the task's language.
 * Missing partials fall back to an empty string (matches the legacy silent
 * `try/catch` in `planGeneration.ts`).
 */
export async function extraTemplateVars(ctx: PlanPromptCtx): Promise<Record<string, unknown>> {
  const { state, task } = ctx;
  const promptBuilder = state.deps?.promptBuilder;
  if (!promptBuilder) return {};

  const techTier = task.techTiers?.length
    ? effectiveTechTier(task.techTiers)
    : getTechTier(state);

  if (!techTier?.language) return {};

  let setupConstraints = '';
  try {
    setupConstraints = await promptBuilder.render(
      `jobs/code/nodes/execute/basis/techTier/${mapLang(techTier.language)}/setup/constraints`,
      {},
    );
  } catch { /* no constraints */ }

  return {
    setupConstraints,
    hasSetupConstraints: !!setupConstraints,
  };
}
