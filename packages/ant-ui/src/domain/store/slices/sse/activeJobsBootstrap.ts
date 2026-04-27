import { isNonTaskJob } from '@ant/shared';
import { resolveAgentForJobType } from '@/shared/utils/constants';

/**
 * Processes the activeJobs array from the SSE initial kanban response.
 * Builds the activeJobs map, auto-selects a running / paused job type on
 * feature entry (guarded by pendingAutoSelect), and syncs the view.
 *
 * Invariant I4 — paused non-task jobs (plan / visual on a clarify card)
 * win over running decomposable jobs in the auto-select tiebreaker. A
 * paused plan is the active conversation; auto-selecting a concurrent
 * code job over it would silently re-route the user's clarify answer
 * (zonal-dreaming-novel regression).
 */
export function handleInitialActiveJobs(
  jobs: Array<{ jobType: string; jobId: string; status: string; agent?: string }>,
  set: any,
  get: any,
): void {
  const map: Record<string, { jobId: string; status: string; agent?: string }> = {};
  for (const j of jobs) {
    map[j.jobType] = { jobId: j.jobId, status: j.status, agent: j.agent };
  }
  set({ activeJobs: map });

  const currentType = get().selectedJobType;
  const shouldAutoSelect = (get() as any).pendingAutoSelect;

  if (shouldAutoSelect && !map[currentType] && jobs.length > 0) {
    set({ pendingAutoSelect: false } as any);
    // Priority order (Invariant I4):
    //   1. Paused non-task job (plan / visual awaiting a clarify answer)
    //   2. Currently running job
    //   3. First job in the list
    const pausedNonTask = jobs.find(j => j.status === 'paused' && isNonTaskJob(j.jobType));
    const runningJob = jobs.find(j => j.status === 'running');
    const winner = pausedNonTask || runningJob || jobs[0];
    const agent = winner.agent || resolveAgentForJobType(winner.jobType);
    console.log(
      `[Store] 🔄 Auto-selecting active job: ${winner.jobType} (status=${winner.status}, was ${currentType})`,
    );
    setTimeout(() => {
      get().setSelectedAgent(agent);
      get().setSelectedJobType(winner.jobType as any);
    }, 0);
  } else {
    set({ pendingAutoSelect: false } as any);
    get().syncViewToJobType(currentType);
  }
}
