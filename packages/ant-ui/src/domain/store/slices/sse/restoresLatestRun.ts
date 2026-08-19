import { isNonTaskJob } from '@ant/shared';

/**
 * May this jobType's `currentJobId` be restored from the latest history run
 * when no live job exists?
 *
 * plan / visual share a feature with the board-owning types (code / design /
 * learn), so auto-selecting their latest run would yank the view off the board
 * the user was looking at (Invariant I4) — they stay excluded.
 *
 * universal is the only jobType of a workspace project, and the job-tab jobId
 * chip is the ONLY affordance that reaches run history (the chip mounts on
 * `currentJobId` alone). Its board is universal-unaware and never carries a
 * jobId, and completion seals the run out of Redis — so without this restore a
 * finished universal run is permanently unreachable from the UI.
 *
 * SSOT: `activeJobsBootstrap`'s feature-entry fallback and `setSelectedJobType`'s
 * auto-select-latest both gate on this one predicate so they cannot drift.
 */
export function restoresLatestRunFromHistory(jobType: string): boolean {
  return !isNonTaskJob(jobType) || jobType === 'universal';
}
