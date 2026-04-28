/**
 * ui/hooks/plan.ts — TaskPlanHook.extraTemplateVars
 *
 * UI tasks flow through the generic `jobs/code/nodes/plan/base` template
 * and only need to surface the workspace-dep-snapshot so the LLM does
 * not pin `react` / `radix-ui` / `@emotion/*` / etc. with a different
 * spec than the rest of the workspace. The hard-reject policy in
 * `manifestPinPolicy.ts` is the authoritative guard; this hook gives
 * the LLM read-only visibility before it writes.
 *
 * R2 — depends only on the shared helper. No imports from `nodes/` /
 * `routers/` / `parallel/`.
 */

export { workspaceDepSnapshotVars as extraTemplateVars } from '../../_shared/helpers/workspaceDepSnapshotHook';
