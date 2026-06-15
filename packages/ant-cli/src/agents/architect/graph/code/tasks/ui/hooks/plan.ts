/**
 * ui/hooks/plan.ts — TaskPlanHook.extraTemplateVars
 *
 * UI tasks flow through the generic `jobs/code/nodes/plan/base` template and
 * surface two things:
 *   1. the workspace-dep-snapshot, so the LLM does not pin `react` /
 *      `radix-ui` / `@emotion/*` etc. with a different spec than the rest of
 *      the workspace (hard-reject guard is `manifestPinPolicy.ts`);
 *   2. the paired feature twin (`pairedFeature`), so the plan builds on the
 *      materialized skeleton and inherits its content authority.
 *
 * R2 — depends only on shared helpers + the ui-local twin helper. No imports
 * from `nodes/` / `routers/` / `parallel/`.
 */

import type { PlanPromptCtx } from '../../_shared/types';
import { workspaceDepSnapshotVars } from '../../_shared/helpers/workspaceDepSnapshotHook';
import { uiTwinVars } from '../twin';

export async function extraTemplateVars(
  ctx: PlanPromptCtx,
): Promise<Record<string, unknown>> {
  const depVars = await workspaceDepSnapshotVars(ctx);
  return { ...depVars, ...uiTwinVars(ctx.state, ctx.task) };
}
