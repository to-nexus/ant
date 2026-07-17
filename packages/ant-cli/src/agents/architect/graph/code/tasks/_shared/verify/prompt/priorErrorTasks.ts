/**
 * `_shared/verify/prompt/priorErrorTasks` — verification prompt inject helper.
 *
 * Surfaces every prior error sub-task (spawned by previous batch-splits in
 * this verification cycle) into the verification plan prompt so the LLM
 * sees what has already been attempted before producing the next plan.
 * Replaces the read_file → `sessions/architect/code.json` lookup pattern
 * (unreliable, costs an LLM round-trip) with state-level injection.
 *
 * Source: `state.completedTasksDetails` filtered by `type === 'error'` AND
 * `batchSplitCount ≥ 1` (the split-born marker stamped by
 * `_shared/batchSplit/process.ts`). Error tasks authored by decompose as
 * siblings of the verification task do NOT qualify — they are ordinary
 * planned work, not evidence that this verification cycle is grounded in a
 * runtime failure. Treating them as such misfires the reproducer
 * requirement / `hasUserRuntimeErrorContext` gate with a non-error
 * directive quoted as the "failing scenario" (orbit-mapping-heart: the
 * verify plan loop lost every legal terminal output and span for 200
 * rounds).
 * Order: natural push order (chronological); no extra sort. No cap
 * (natural ceiling = MAX_BATCH_SPLIT_CYCLES × avg-batches ≈ 50).
 *
 * R2 — depends only on the graph state shape and CodeTask type.
 */

import type { ArchitectGraphState } from '../../../../state';

export interface PriorErrorTaskEntry {
  /** task.name (= batch.name) */
  name: string;
  /** task.description (= batch.rationale, root cause info woven in) */
  description: string;
}

/**
 * Returns the list of prior error sub-tasks. Returns `undefined` (not `[]`)
 * when none exist so the Handlebars `{{#if priorErrorTasks}}` guard hides
 * the whole section on cycle-1 fresh entries.
 */
export function renderPriorErrorTasks(
  state: ArchitectGraphState,
): PriorErrorTaskEntry[] | undefined {
  const entries = (state.completedTasksDetails ?? [])
    .filter(t => t.type === 'error' && ((t.batchSplitCount ?? 0) > 0))
    .map(t => ({ name: t.name, description: t.description }));
  return entries.length > 0 ? entries : undefined;
}
