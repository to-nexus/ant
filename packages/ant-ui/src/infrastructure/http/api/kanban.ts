import type { KanbanData } from '@ant/shared';
import { API_BASE, apiGet, featureSeg } from './client';

// Re-export shared types (canonical source: @ant/shared)
export type {
  TaskType, TaskStatus,
  JobType, DecomposableJobType, JobTiming,
  TaskTiming, TaskTokenUsage,
  BaseTask, KanbanData,
  InterruptionReason, InterruptionDetails,
} from '@ant/shared';

/**
 * Fetch complete Kanban board data for a feature.
 * Returns ready-to-render data (no client-side merging needed).
 */
export function fetchKanbanData(
  projectId: string,
  featureName: string,
  job: string,
): Promise<KanbanData> {
  const url = `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${featureSeg(featureName)}/kanban?job=${job}`;
  return apiGet<KanbanData>(url).catch((err) => {
    // Transport resilience: an unreachable board must not break the view —
    // but log loudly so a silently-failing endpoint (e.g. the historical
    // route-shadowing 400) is visible instead of masquerading as an empty board.
    console.error('[kanban] board fetch failed', err);
    return {
      todo: [],
      inProgress: [],
      completed: [],
      isEstimating: false,
      dataSource: 'session' as const,
    };
  });
}

/**
 * Restore the kanban for a single (possibly past) jobId. Resolves to the
 * live snapshot when Redis still holds it, otherwise to the per-jobId
 * snapshot persisted in the session file's `runs[]` array. Falls back to
 * an empty board when neither source has data.
 */
export function fetchKanbanByJobId(
  projectId: string,
  featureName: string,
  jobId: string,
  jobType: string,
): Promise<KanbanData> {
  const url = `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${featureSeg(featureName)}/kanban?jobId=${encodeURIComponent(jobId)}&type=${encodeURIComponent(jobType)}`;
  return apiGet<KanbanData>(url).catch(() => ({
    jobId,
    todo: [],
    inProgress: [],
    completed: [],
    isEstimating: false,
    dataSource: 'session' as const,
  }));
}
