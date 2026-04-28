/**
 * feature/hooks/plan.ts — TaskPlanHook.extraTemplateVars
 *
 * Feature tasks flow through the generic `jobs/code/nodes/plan/base`
 * template. They publish only the workspace-dep-snapshot template var
 * so the partial in the base template ({{> workspace-dep-snapshot}}) sees
 * the codebase-wide pin set when planning.
 *
 * Why feature publishes this hook (the bundle's docstring previously
 * listed plan as intentionally absent): a feature task can introduce a
 * brand-new dependency manifest under `packages/<sub>/` (e.g. a
 * follow-on package added after Setup completed). Without snapshot
 * visibility the LLM cannot tell that the workspace already pinned a
 * library and may pick a different version. The hard-reject policy in
 * `manifestPinPolicy.ts` catches the violation at write time, but
 * surfacing the pins up front turns the failure mode into a no-op.
 *
 * R2 — depends only on the shared helper. No imports from `nodes/` /
 * `routers/` / `parallel/`.
 */

export { workspaceDepSnapshotVars as extraTemplateVars } from '../../_shared/helpers/workspaceDepSnapshotHook';
