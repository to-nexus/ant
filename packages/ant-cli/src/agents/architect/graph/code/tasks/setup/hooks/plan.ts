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
import { mapLang } from '../../_shared/helpers/planPrompt';
import { workspaceDepSnapshotVars } from '../../_shared/helpers/workspaceDepSnapshotHook';

/**
 * Resolve the tech-tier setup-constraints partial for the task's language
 * AND the workspace dependency-pin snapshot. Missing constraint partials
 * fall back to an empty string (matches the legacy silent `try/catch` in
 * `planGeneration.ts`); the snapshot helper is similarly fail-soft and
 * returns an inert payload when the codebase has no manifests yet.
 */
export async function extraTemplateVars(ctx: PlanPromptCtx): Promise<Record<string, unknown>> {
  const { state, task } = ctx;
  const promptBuilder = state.deps?.promptBuilder;
  if (!promptBuilder) {
    return await workspaceDepSnapshotVars(ctx);
  }

  const techTier = task.techTiers?.length
    ? effectiveTechTier(task.techTiers)
    : getTechTier(state);

  let setupConstraints = '';
  if (techTier?.language) {
    try {
      setupConstraints = await promptBuilder.render(
        `jobs/code/nodes/execute/basis/techTier/${mapLang(techTier.language)}/setup/constraints`,
        {},
      );
    } catch { /* no constraints */ }
  }

  return {
    setupConstraints,
    hasSetupConstraints: !!setupConstraints,
    ...await workspaceDepSnapshotVars(ctx),
  };
}
