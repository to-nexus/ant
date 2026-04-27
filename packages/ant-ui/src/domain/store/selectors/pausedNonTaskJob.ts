/**
 * Paused non-task job selector — Invariant I1 SSOT (FE side).
 *
 * Non-task jobs (plan / visual) pause via clarify cards rather than the
 * task-resume / interruption flow used by decomposable jobs. While such a
 * job is paused, every enqueue path (clarify submit, chat submit, runJob)
 * MUST forward its (jobType, agent) instead of the store's selectedJobType
 * / selectedAgent. Otherwise a drifted store state (auto-select after SSE
 * reconnect, action-card defaults, etc.) hijacks the clarify answer into
 * a brand-new code job — the zonal-dreaming-novel regression.
 *
 * Source of truth: `state.activeJobs` map populated by the SSE initial
 * payload + jobSlice. An entry is treated as paused when its `status` is
 * `'paused'` (BullMQ + JobStateTracker terminology).
 */
import { isNonTaskJob, type NonTaskJobType } from '@ant/shared';
import type { StoreState } from '../types';
import { resolveAgentForJobType } from '@/shared/utils/constants';

export interface PausedNonTaskJob {
  jobType: NonTaskJobType;
  agent: string;
  jobId: string;
}

/**
 * Returns the first paused non-task job (plan or visual) from the
 * activeJobs map, or `null` when none is paused. The agent falls back to
 * `resolveAgentForJobType` when the activeJobs entry omits it (older SSE
 * payloads).
 */
export function selectPausedNonTaskJob(state: StoreState): PausedNonTaskJob | null {
  const map = state.activeJobs;
  if (!map) return null;
  for (const [jobType, entry] of Object.entries(map)) {
    if (!entry || entry.status !== 'paused') continue;
    if (!isNonTaskJob(jobType)) continue;
    return {
      jobType,
      agent: entry.agent || resolveAgentForJobType(jobType),
      jobId: entry.jobId,
    };
  }
  return null;
}
