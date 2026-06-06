/**
 * test-code/hooks/plan.ts — TaskPlanHook.extraTemplateVars
 *
 * Test-code is a NON-forking task type: it flows through the shared
 * `jobs/code/nodes/plan/base` template (which gate-includes the
 * `test-code-protocol` overlay and the shared FAN-OUT / capacity rubric)
 * exactly like feature / ui / design-system. This hook only contributes the
 * type-specific template vars the generic path does not already compute:
 *   - workspace-dep-snapshot (shared with ui/setup),
 *   - `packageManager` (install command in the test-code protocol overlay),
 *   - `languageHints` (ecosystem test-runner hints, reused from the
 *     verification basis hints tree).
 *
 * R2 — no imports from `nodes/` / `routers/` / `parallel/`.
 */

import { effectiveTechTier, getTechTier } from '@ant/shared';
import type { PlanPromptCtx } from '../../_shared/types';
import { mapLang } from '../../_shared/helpers/planPrompt';
import { workspaceDepSnapshotVars } from '../../_shared/helpers/workspaceDepSnapshotHook';

export async function extraTemplateVars(ctx: PlanPromptCtx): Promise<Record<string, unknown>> {
  const { state, task } = ctx;
  const depSnapshot = await workspaceDepSnapshotVars(ctx);

  const techTier = task.techTiers?.length
    ? effectiveTechTier(task.techTiers)
    : getTechTier(state);
  const packageManager = techTier?.packageManager || state._detectedPackageManager || undefined;

  // Reuse the verification / error language-hints surface so a new test-code
  // hint tree is not required; the hints are framework-agnostic enough.
  let languageHints = '';
  const promptBuilder = state.deps?.promptBuilder;
  if (techTier?.language && promptBuilder) {
    try {
      languageHints = await promptBuilder.render(
        `jobs/code/nodes/plan/variants/verification/basis/techTier/${mapLang(techTier.language)}/hints`,
        {},
      );
    } catch { /* no hints */ }
  }

  return {
    ...depSnapshot,
    packageManager,
    hasPackageManager: !!packageManager,
    languageHints,
    hasLanguageHints: !!languageHints,
  };
}
