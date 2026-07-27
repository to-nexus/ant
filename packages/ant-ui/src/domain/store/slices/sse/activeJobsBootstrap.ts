import { isNonTaskJob } from '@ant/shared';

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
    console.log(
      `[Store] 🔄 Auto-selecting active job: ${winner.jobType} (status=${winner.status}, was ${currentType})`,
    );
    // SSOT: setSelectedJobType funnels through applyJobIdentity (which sets the
    // agent from the job type) and performs the type-scoped session+kanban
    // fetch + syncViewToJobType the bootstrap relies on.
    setTimeout(() => {
      get().setSelectedJobType(winner.jobType as any);
    }, 0);
  } else {
    set({ pendingAutoSelect: false } as any);
    get().syncViewToJobType(currentType);

    // No active jobs AND nothing selected: fall back to the latest same-type
    // run from job history (mirrors setSelectedJobType's auto-select-latest).
    // A user-stopped job is sealed out of Redis (activeJobs === []) but stays
    // restorable via its session snapshot — without this fallback the refresh
    // path has no recovery and the board/tab stay blank. Deferred so the
    // initial-kanban board applied later in this same SSE event wins when it
    // carries a jobId (session-priority board of a stopped job).
    if (jobs.length === 0 && !isNonTaskJob(currentType)) {
      setTimeout(async () => {
        const s = get();
        if (s.currentJobId || s.jobStartPending) return;
        if (!s.selectedProject || !s.selectedFeature || s.selectedJobType !== currentType) return;
        try {
          const { fetchJobHistory } = await import('@/infrastructure/http/api');
          const history = await fetchJobHistory(s.selectedProject, s.selectedFeature);
          const latest = history.jobs.find((j: any) => j.type === currentType);
          if (latest && !get().currentJobId && !get().jobStartPending) {
            await get().selectJobId(latest.jobId, { live: latest.live, jobType: currentType });
          }
        } catch {
          // best-effort — history fallback must never throw into the SSE handler
        }
      }, 0);
    }
  }
}
