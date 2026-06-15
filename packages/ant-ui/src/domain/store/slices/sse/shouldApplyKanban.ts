import type { KanbanData } from '@/infrastructure/http/api';

/**
 * Decide whether an incoming kanban broadcast should be applied to the store
 * for the currently-viewed job tab.
 *
 * Apply when ANY holds:
 *  - the broadcast carries no `jobType` (legacy / job-agnostic snapshot), OR
 *  - it matches the viewed tab (`selectedJobType`), OR
 *  - it is the actively-running job for this feature (`dataSource` is `'live'`
 *    or `'estimating'`).
 *
 * The third clause is the fix for the blank-board regression: the running job
 * must drive the board even before `selectedJobType` has synced to it. When a
 * job starts, the worker runs triage→detect→decompose (broadcasting
 * `isEstimating:true` updates stamped with the real `jobType`) BEFORE the
 * action resolves and `setSelectedJobType` fires. During that window
 * `selectedJobType` still holds its default/previous value, so a strict
 * `jobType === selectedJobType` guard dropped every pre-task estimating
 * broadcast and the decompose skeleton never showed — tasks only appeared once
 * the tab synced. Treating live/estimating broadcasts as authoritative for the
 * active feature closes that race. Job-agnostic by construction → code and
 * design behave identically.
 *
 * NOTE: with continuous re-convergence (`reconvergeJobType`), `selectedJobType`
 * now snaps to the live job's type before this gate runs, so clause 3 is
 * redundant in steady state (clause 2 already matches). It is retained as the
 * first-tick bootstrap for the very first broadcast within a handler tick,
 * before re-convergence has applied. Removing it would reopen the race above.
 */
export function shouldApplyKanban(
  data: Pick<KanbanData, 'jobType' | 'dataSource'>,
  selectedJobType: string | undefined,
): boolean {
  if (!data.jobType) return true;
  if (data.jobType === selectedJobType) return true;
  return data.dataSource === 'live' || data.dataSource === 'estimating';
}
