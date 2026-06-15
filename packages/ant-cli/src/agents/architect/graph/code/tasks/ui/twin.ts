/**
 * tasks/ui/twin.ts — derive a ui task's paired feature twin.
 *
 * The decompose SSOT pairs a renderable feature with its ui pass by giving
 * them the same `parallelGroup` (see `responseParser` `renderable` derive). A
 * ui task layers visuals on the headless skeleton its feature twin authored, so
 * its plan/execute prompt should surface that twin explicitly: the twin's FULL
 * (untruncated) description carries the content authority (the PRD / spec
 * sections the feature desc already cites), and its file list is the structure
 * the ui pass builds on. Without this the ui task only sees the handoff visual
 * source and re-derives content from the markup — dropping PRD-defined content
 * the handoff prototype omits.
 *
 * Distinct from `priorCompletedFiles` (the task-type-blind discovery index of
 * ALL prior outputs): this elevates the ONE always-relevant twin so the ui
 * prompt does not have to infer it from file overlap. R2 — depends only on the
 * graph state shape and the CodeTask type; no import from `nodes/` / `routers/`
 * / `parallel/`.
 */

import type { ArchitectGraphState } from '../../state';
import type { CodeTask } from '../../../../types/task';

export interface PairedFeatureVar {
  /** twin feature task.name */
  name: string;
  /** twin feature task.description, FULL (not truncated) — carries content authority. */
  description: string;
  /** feature-relative paths the twin feature authored (the skeleton to build on). */
  files: string[];
}

/**
 * Find the completed feature task that shares this ui task's `parallelGroup`.
 * `null` when the ui task has no paired feature (rare) or the twin has not
 * completed yet.
 */
export function findPairedFeature(
  state: ArchitectGraphState,
  task: CodeTask,
): PairedFeatureVar | null {
  const group = task.parallelGroup;
  if (!group) return null;
  const twin = (state.completedTasksDetails ?? []).find(
    (t) => t.type === 'feature' && t.parallelGroup === group && t.id !== task.id,
  );
  if (!twin) return null;
  return {
    name: twin.name,
    description: (twin.description ?? '').trim(),
    files: Array.isArray(twin.touchedFiles) ? twin.touchedFiles : [],
  };
}

/**
 * `extraTemplateVars` contribution: `{ pairedFeature }` when a twin exists,
 * `{}` otherwise (so callers can spread unconditionally and the template's
 * `{{#if pairedFeature}}` gate hides the block when absent).
 */
export function uiTwinVars(
  state: ArchitectGraphState,
  task: CodeTask,
): Record<string, unknown> {
  const pairedFeature = findPairedFeature(state, task);
  return pairedFeature ? { pairedFeature } : {};
}
