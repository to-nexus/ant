/**
 * design-system/hooks/plan.ts — TaskPlanHook.extraTemplateVars
 *
 * Design-system tasks routinely pull in tailwindcss / radix-ui /
 * @emotion/* / class-variance-authority / etc. They share the generic
 * `jobs/code/nodes/plan/base` template; the workspace-dep-snapshot
 * partial fires only when this hook publishes its template variables.
 *
 * Without the hook, the partial's `{{#if hasWorkspaceDepSnapshot}}` gate
 * stays false for design-system tasks even when the snapshot has pins,
 * so the LLM would pick versions blind. Cost of writing then getting
 * rejected by the policy guard is real (a wasted plan→execute cycle);
 * surfacing the snapshot at plan time turns the rejection rate to zero.
 *
 * R2 — depends only on the shared helper.
 */

export { workspaceDepSnapshotVars as extraTemplateVars } from '../../_shared/helpers/workspaceDepSnapshotHook';
