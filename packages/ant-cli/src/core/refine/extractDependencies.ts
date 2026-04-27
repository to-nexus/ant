/**
 * extractDependencies — design task → cited PRD/GDD section graph.
 *
 * The plan-density restoration work introduced stable identifier
 * conventions for PRD/GDD (`SC-`, `FL-`, `FR-`, `CP-`, `EN-`, `RB-` for
 * service; `CL-`, `MC-`, `EN-`, `LV-`, `RW-`, `GM-`, `MP-` for game)
 * and made design decompose templates cite those identifiers in each
 * task's description / `assignedSections`. This helper grep-extracts
 * the citations so a follow-up `rev-plan` job can ask "which design
 * tasks elaborated this PRD §X?"
 *
 * Pipeline-mode awareness:
 *
 * - **infer**: `intent` matrix path-default activates `inputs/sources/*`
 *   (PRD/GDD) as `role='ref'`, so the LLM almost always sees PRD/GDD
 *   content and cites stable ids. `hasPrdRef` is true.
 * - **explicit + PRD ref**: same shape — pool carries the plan doc as
 *   ref, citations land in task descriptions.
 * - **explicit + PRD ref *omitted***: a user explicitly omitting the
 *   plan doc from `actionMetadata.refs` produces a checkpoint where
 *   `assignedSections` may still cite §X for catalog reasons but the
 *   task description grep can underdetect dependencies. F3 surfaces
 *   this as a meta alert (FE banner) so the operator knows the affected
 *   tasks may be silently stale.
 */

import type { ResolvedActionContext } from '@ant/shared';
import type { DesignTask } from '../../agents/architect/types/task';

/**
 * One row of the dependency graph: a single design task's PRD/GDD
 * citation surface, plus a flag that lets `detectAffectedTasks` filter
 * out tasks built without the plan document in scope (so a stale-alert
 * doesn't get fired against a task that never saw the doc to cite).
 */
export interface TaskDependency {
  taskId: string;
  taskName: string;
  /** Files this task targets (e.g. fe-system-main.md). Useful for the FE alert summary. */
  targetFile?: string;
  /** Identifiers extracted from `task.description` + `task.assignedSections`. Sorted, deduplicated. */
  citedSections: string[];
  /**
   * Whether the design checkpoint's `resolvedAction.refs` contained the
   * canonical plan filename (`inputs/sources/prd.md` or `gdd.md`) at
   * the time this task was built.
   *
   * When false, `detectAffectedTasks` MUST exclude this task from the
   * affected list — the LLM never saw the plan doc so the citation
   * grep can return false negatives. The FE meta alert ("N tasks
   * built without PRD/GDD ref") surfaces these so users don't assume
   * the sync is silent.
   */
  hasPrdRef: boolean;
}

/**
 * Subset of the persisted design session checkpoint that the
 * dependency extractor needs. Defined as a structural subset so this
 * module doesn't depend on the full SessionState type.
 */
export interface DesignSessionCheckpointLike {
  taskQueue?: DesignTask[];
  completedTasksDetails?: DesignTask[];
  resolvedAction?: ResolvedActionContext;
}

// ─────────────────────────────────────────────────────────────────────
// Identifier patterns (keep aligned with plan-density-restoration)
// ─────────────────────────────────────────────────────────────────────
//
// `extractorVersion` increments whenever this set changes so callers
// cached an old set know to recompute. Currently bumped to '1' — the
// initial F3 release.
export const EXTRACTOR_VERSION = '1';

const PATTERNS: RegExp[] = [
  // Section markers — `PRD §6`, `GDD §4.2`, etc.
  /\b(?:PRD|GDD)\s*§\s*\d+(?:\.\d+)?/g,
  // Service-axis identifier prefixes
  /\bSC-[A-Za-z][\w-]*/g,
  /\bFL-[A-Za-z][\w-]*/g,
  /\bFR-\d+/g,
  /\bCP-[A-Za-z][\w-]*/g,
  /\bRB-[A-Za-z][\w-]*/g,
  // Shared-axis identifier prefix (EN- appears in both service and
  // game catalogs — entity catalog).
  /\bEN-[A-Za-z][\w-]*/g,
  // Game-axis identifier prefixes
  /\bCL-[A-Za-z][\w-]*/g,
  /\bMC-[A-Za-z][\w-]*/g,
  /\bLV-[A-Za-z][\w-]*/g,
  /\bRW-[A-Za-z][\w-]*/g,
  /\bGM-[A-Za-z][\w-]*/g,
  /\bMP-[A-Za-z][\w-]*/g,
];

/**
 * Normalise a `PRD §6` / `GDD §4.2` capture by collapsing whitespace
 * around the `§` so identical citations written with different
 * spacing (`PRD §6`, `PRD § 6`) collapse to a single entry.
 */
function normaliseCitation(raw: string): string {
  return raw.replace(/\s+/g, ' ').replace(/\s*§\s*/, ' §');
}

function extractIdentifiers(haystack: string | undefined | null): string[] {
  if (!haystack) return [];
  const found = new Set<string>();
  for (const re of PATTERNS) {
    // Must reset lastIndex when reusing global regexes across calls.
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(haystack)) !== null) {
      found.add(normaliseCitation(m[0]));
    }
  }
  return [...found].sort();
}

const PLAN_PATHS = ['inputs/sources/prd.md', 'inputs/sources/gdd.md'];

/**
 * Decide whether the checkpoint's RAC.refs contained a canonical plan
 * document at the time the task list was authored. Used as a guard on
 * `TaskDependency.hasPrdRef`.
 */
function hasPlanDocAsRef(rac: ResolvedActionContext | undefined): boolean {
  if (!rac?.refs?.length) return false;
  return rac.refs.some(p => PLAN_PATHS.includes(p));
}

/**
 * Iterate every authored task (queued + completed) in the checkpoint
 * and produce one TaskDependency per task. Authored implies the task
 * survived decompose; tasks deleted by a subsequent revise pass are
 * naturally absent from the checkpoint and so excluded automatically.
 */
function gatherTasks(
  checkpoint: DesignSessionCheckpointLike,
): DesignTask[] {
  const tasks: DesignTask[] = [];
  for (const t of checkpoint.taskQueue ?? []) tasks.push(t);
  for (const t of checkpoint.completedTasksDetails ?? []) tasks.push(t);
  return tasks;
}

/**
 * Extract the design-job dependency graph from a session checkpoint.
 *
 * `description` is the primary citation surface (decompose templates
 * require `Implements PRD §X / SC-Y` style entries). `assignedSections`
 * is also grepped — some catalogs still surface `§X` there even when
 * the description omits it.
 */
export function extractDependencies(
  checkpoint: DesignSessionCheckpointLike,
): TaskDependency[] {
  const refsHavePlan = hasPlanDocAsRef(checkpoint.resolvedAction);
  const tasks = gatherTasks(checkpoint);

  const seen = new Set<string>();
  const out: TaskDependency[] = [];

  for (const task of tasks) {
    if (!task?.id || seen.has(task.id)) continue;
    seen.add(task.id);

    const haystack = [
      task.description ?? '',
      ...(task.assignedSections ?? []),
    ].join('\n');
    const cited = extractIdentifiers(haystack);

    out.push({
      taskId: task.id,
      taskName: task.name,
      targetFile: task.targetFile,
      citedSections: cited,
      hasPrdRef: refsHavePlan,
    });
  }

  return out;
}

/**
 * Convenience filter: tasks whose `hasPrdRef` is false. The FE meta
 * banner is built from this list so the user sees which design tasks
 * the synchronisation can NOT speak about.
 */
export function tasksWithoutPlanRef(
  deps: TaskDependency[],
): TaskDependency[] {
  return deps.filter(d => !d.hasPrdRef);
}
