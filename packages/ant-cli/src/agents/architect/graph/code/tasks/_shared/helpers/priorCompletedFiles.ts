/**
 * tasks/_shared/helpers/priorCompletedFiles.ts — cross-task output manifest.
 *
 * Surfaces the files already authored by prior tasks in THIS job into the
 * plan / execute prompt of every later task, so a task no longer re-infers
 * (and re-creates) what a sibling already produced — the shared SV store, a
 * route, a component, a contract. The defect this closes: feature tasks were
 * structurally blind to the platform owner's output (the worker's RAC pool is
 * the decompose-time snapshot; `completedTasksDetails` was rendered only into
 * the verification prompt via `verify/prompt/priorErrorTasks.ts`). The file
 * bodies are NOT injected — they are reachable on-demand via the RAC-orthogonal
 * codebase read path; this manifest only announces their existence so the LLM
 * reads/imports instead of recreating.
 *
 * Orthogonal to `priorErrorTasks` (verification-only; carries prior FIX
 * attempts by name/description, no file paths). Both read
 * `state.completedTasksDetails`; neither is a substitute for the other.
 *
 * R2 — depends only on the graph state shape and the CodeTask type; no
 * import from `nodes/` / `routers/` / `parallel/`. Task-type-blind: every
 * completed task is surfaced identically (band is read for display only).
 */

import type { ArchitectGraphState } from '../../../state';
import type { CodeTask } from '../../../../../types/task';

export interface PriorCompletedTaskFiles {
  /** task.name */
  name: string;
  /** task.type (setup | design-system | ui | feature | error | …) — what KIND of work produced these files */
  type: string;
  /** FeatureTask band ('foundation' | 'platform' | 'integration'), else undefined — display label only */
  band?: string;
  /**
   * task.description truncated to ~180 chars. Carries intent that the path/name
   * cannot — chiefly for shared-infra owners (setup/foundation/platform/
   * design-system) whose conventions (toggle env names, sealed scope, which
   * spec section) live only in prose. Truncated so the manifest stays compact
   * for late tasks (descriptions run up to ~1100 chars). Empty string if absent.
   */
  desc: string;
  /** feature-relative paths this task created or modified */
  files: string[];
}

const DESC_MAX = 180;

function truncateDesc(raw: string | undefined): string {
  const d = (raw ?? '').trim().replace(/\s+/g, ' ');
  return d.length > DESC_MAX ? `${d.slice(0, DESC_MAX)}…` : d;
}

/**
 * Returns the per-task file manifest of every prior completed task that wrote
 * at least one file, excluding the current task. Returns `undefined` (not `[]`)
 * when none qualify so the Handlebars `{{#if priorCompletedFiles}}` guard hides
 * the whole section on the first task.
 */
export function renderPriorCompletedFiles(
  state: ArchitectGraphState,
  currentTask?: CodeTask | null,
): PriorCompletedTaskFiles[] | undefined {
  const currentId = currentTask?.id;
  const entries: PriorCompletedTaskFiles[] = [];
  for (const t of state.completedTasksDetails ?? []) {
    if (t.id === currentId) continue;
    const files = Array.isArray(t.touchedFiles) ? t.touchedFiles : [];
    if (files.length === 0) continue;
    entries.push({
      name: t.name,
      type: t.type,
      // band lives only on FeatureTask; read positionally to stay task-type-blind.
      band: (t as { band?: string }).band,
      desc: truncateDesc(t.description),
      files,
    });
  }
  return entries.length > 0 ? entries : undefined;
}
