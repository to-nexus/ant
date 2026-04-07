import { resolveAgentForJobType } from '@/shared/utils/constants';

/**
 * Processes the activeJobs array from the SSE initial kanban response.
 * Builds the activeJobs map, auto-selects a running job type on feature
 * entry (guarded by pendingAutoSelect), and syncs the view.
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
    const runningJob = jobs.find(j => j.status === 'running') || jobs[0];
    const agent = runningJob.agent || resolveAgentForJobType(runningJob.jobType);
    console.log(`[Store] 🔄 Auto-selecting active job: ${runningJob.jobType} (was ${currentType})`);
    setTimeout(() => {
      get().setSelectedAgent(agent);
      get().setSelectedJobType(runningJob.jobType as any);
    }, 0);
  } else {
    set({ pendingAutoSelect: false } as any);
    get().syncViewToJobType(currentType);
  }
}
