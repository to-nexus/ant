/**
 * tasks/_shared/helpers/workspaceDepSnapshotHook — single
 * `extraTemplateVars` provider that injects the workspace-wide dependency
 * pin snapshot into plan / execute prompts.
 *
 * Shared by every task type that may write or extend a dependency
 * manifest: setup, feature, ui, error, design-system, test-code.
 * Verify-mode also calls this directly from
 * `_shared/verify/prompt/buildPlanPrompt.ts` because that path bypasses the
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
 * Variable set returned by {@link workspaceDepSnapshotVars}.
 *
 * The original `workspaceDepSnapshot` block is the dependency-pin
 * surface (existing partial). The `monorepo*` block is the
 * install-locality surface added in Section B of the
 * test-code-script-wiring + monorepo-install-locality plan — consumed
 * by `jobs/code/base/injections/monorepo-install-locality.md`.
 */
export interface WorkspaceDepSnapshotVars {
  // Permits the spread-into-`Record<string, unknown>` pattern that
  // every plan-hook call site uses (`...await workspaceDepSnapshotVars(ctx)`).
  // Removing this signature breaks every consumer that expects the
  // result to be assignable to `Record<string, unknown>`.
  [key: string]: unknown;
  workspaceDepSnapshot: string;
  hasWorkspaceDepSnapshot: boolean;
  /**
   * `true` when `state.workspaceState.monorepo` is set — i.e. a
   * workspace marker was observed inside `codebase/` by
   * `analyzeWorkspace`. Single-package projects render `false` and
   * the install-locality partial self-gates to empty output.
   */
  monorepoActive: boolean;
  /**
   * Workspace root, relative to the feature directory. Conventionally
   * `'codebase'`. `undefined` when `monorepoActive=false`.
   */
  monorepoRootPath?: string;
  /**
   * Workspace marker label (e.g. `pnpm-workspace`, `npm-workspaces`,
   * `cargo-workspace`). Used by the partial to dispatch to the
   * SBS-gated invocation hint for that marker.
   */
  monorepoManagerLabel?: string;
  /**
   * Filename that triggered the marker detection (e.g.
   * `pnpm-workspace.yaml`, `Cargo.toml`). Surfaced for orientation
   * only; never used for control flow.
   */
  monorepoRootMarker?: string;
  /**
   * One-line summary of detected member globs, suitable for prompt
   * rendering: `"<count> member(s): <first up to 5 joined with ', '>[, …]"`.
   * `undefined` when the marker is present but member set is empty
   * (the partial then renders without the member listing).
   */
  monorepoMembersSummary?: string;
}

/**
 * Build the workspace-dep-snapshot template variables for a plan
 * prompt. Returns an empty visible-section payload when the codebase
 * has no manifests or no pins, so call sites can spread the result
 * unconditionally.
 *
 * Consumes `ctx.state.workspaceState.monorepo` (populated by triage's
 * `analyzeWorkspace`) — never re-scans disk for marker detection
 * here, keeping the SSOT in one place.
 */
export async function workspaceDepSnapshotVars(
  ctx: PlanPromptCtx,
): Promise<WorkspaceDepSnapshotVars> {
  const featureRoot = ctx.state.context?.featurePath;
  if (!featureRoot) {
    return {
      workspaceDepSnapshot: '',
      hasWorkspaceDepSnapshot: false,
      monorepoActive: false,
    };
  }
  const snap = await scanWorkspaceDepPins(featureRoot);
  const rendered = renderSnapshotForPrompt(snap);

  const monorepo = (ctx.state as { workspaceState?: { monorepo?: import('../../../../../../common/graph/nodes/triage/types').MonorepoLayout } })
    .workspaceState?.monorepo;
  const monorepoActive = !!monorepo;

  let monorepoMembersSummary: string | undefined;
  if (monorepo && monorepo.members && monorepo.members.length > 0) {
    const first = monorepo.members.slice(0, 5).join(', ');
    const more = monorepo.members.length > 5 ? `, … (+${monorepo.members.length - 5} more)` : '';
    monorepoMembersSummary = `${monorepo.members.length} member(s): ${first}${more}`;
  }

  return {
    workspaceDepSnapshot: rendered,
    hasWorkspaceDepSnapshot: rendered.length > 0,
    monorepoActive,
    monorepoRootPath: monorepo?.rootPath,
    monorepoManagerLabel: monorepo?.manager,
    monorepoRootMarker: monorepo?.rootMarker,
    monorepoMembersSummary,
  };
}
