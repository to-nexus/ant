/**
 * tasks/_shared/helpers/workspaceDepSnapshotHook — single
 * `extraTemplateVars` provider that injects the workspace-wide dependency
 * pin snapshot into plan / execute prompts.
 *
 * Shared by every task type that may write or extend a dependency
 * manifest: setup, feature, ui, error, design-system, test-code.
 * Verify-mode also calls this directly from
 * `_shared/verify/buildPlanPrompt.ts` because that path bypasses the
 * apply-phase hook surface.
 *
 * The snapshot lives on the codebase disk (single source of truth via
 * `scanWorkspaceDepPins`); rendering it into the prompt at plan/execute
 * build time means downstream tasks can see what their predecessors
 * already pinned without any cross-task channel coordination.
 *
 * Failure isolation: the helper never throws on disk read errors —
 * `scanWorkspaceDepPins` already swallows per-manifest read failures and
 * returns an empty / partial snapshot, which the partial template's
 * `{{#if hasWorkspaceDepSnapshot}}` gate hides naturally.
 *
 * R2 — depends only on `_shared/types` + the common-tool helper. No
 * imports from `nodes/` / `routers/` / `parallel/`.
 */

import type { PlanPromptCtx } from '../types';
import {
  scanWorkspaceDepPins,
  renderSnapshotForPrompt,
} from '../../../../../../common/tool/handlers/workspaceDepPins';

/**
 * Build the workspace-dep-snapshot template variables for a plan
 * prompt. Returns an empty visible-section payload when the codebase
 * has no manifests or no pins, so call sites can spread the result
 * unconditionally.
 */
export async function workspaceDepSnapshotVars(
  ctx: PlanPromptCtx,
): Promise<{ workspaceDepSnapshot: string; hasWorkspaceDepSnapshot: boolean }> {
  const featureRoot = ctx.state.context?.featurePath;
  if (!featureRoot) {
    return { workspaceDepSnapshot: '', hasWorkspaceDepSnapshot: false };
  }
  const snap = await scanWorkspaceDepPins(featureRoot);
  const rendered = renderSnapshotForPrompt(snap);
  return {
    workspaceDepSnapshot: rendered,
    hasWorkspaceDepSnapshot: rendered.length > 0,
  };
}
