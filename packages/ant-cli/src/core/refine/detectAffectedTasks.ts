/**
 * detectAffectedTasks — fan-out from a `PlanDiff` to the design tasks
 * that cite the changed sections / identifiers.
 *
 * Two safety rails:
 *
 * 1. Tasks built **without the canonical plan doc as `role='ref'`**
 *    (`hasPrdRef === false`) are excluded — the LLM never saw the
 *    plan content so its citation surface is unreliable. The FE meta
 *    banner in F3.6 surfaces the count of such tasks separately so
 *    operators don't assume the sync is silent.
 *
 * 2. Identifiers are matched **after** normalising whitespace around
 *    the `§` glyph, which `extractDependencies` and `extractPlanDiff`
 *    both apply on their inputs. That keeps `PRD §6` ≡ `PRD § 6` ≡
 *    `PRD\u00a0§6` for matching purposes.
 */

import type { PlanDiff } from './extractPlanDiff';
import type { TaskDependency } from './extractDependencies';

export interface AffectedTask {
  taskId: string;
  taskName: string;
  targetFile?: string;
  /** Subset of `diff.updatedSections` that this task actually cites. */
  matchedSections: string[];
  /** Human-readable reasons (one per matched section). */
  reasons: string[];
}

export interface DetectAffectedTasksResult {
  affected: AffectedTask[];
  /** Tasks excluded because `hasPrdRef === false`. UI surfaces this as a meta alert. */
  unscannableTaskIds: string[];
}

function normaliseId(id: string): string {
  return id.replace(/\s+/g, ' ').replace(/\s*§\s*/, ' §').trim();
}

/**
 * Compute a normalised lookup set so `task.citedSections.includes(...)`
 * style comparisons are O(1) and tolerant of whitespace variation.
 */
function buildLookup(updated: string[]): Set<string> {
  return new Set(updated.map(normaliseId));
}

export function detectAffectedTasks(
  diff: PlanDiff,
  deps: TaskDependency[],
): DetectAffectedTasksResult {
  const updatedLookup = buildLookup(diff.updatedSections);
  const affected: AffectedTask[] = [];
  const unscannableTaskIds: string[] = [];

  for (const dep of deps) {
    if (!dep.hasPrdRef) {
      // Surface the task to the meta banner instead of the affected list —
      // we cannot honestly say it depends on a §X it never had a chance
      // to cite.
      unscannableTaskIds.push(dep.taskId);
      continue;
    }

    const matched: string[] = [];
    for (const cited of dep.citedSections) {
      if (updatedLookup.has(normaliseId(cited))) {
        matched.push(cited);
      }
    }
    if (matched.length === 0) continue;

    affected.push({
      taskId: dep.taskId,
      taskName: dep.taskName,
      targetFile: dep.targetFile,
      matchedSections: matched,
      reasons: matched.map(
        section => `${diff.doc} ${section} updated; this task cited it.`,
      ),
    });
  }

  return { affected, unscannableTaskIds };
}
