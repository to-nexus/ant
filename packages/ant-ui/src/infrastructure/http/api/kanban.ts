import type { KanbanData } from '@ant/shared';
import { API_BASE, apiGet } from './client';

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
  job: string = 'code',
): Promise<KanbanData> {
  const url = `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/kanban?job=${job}`;
  return apiGet<KanbanData>(url).catch(() => ({
    todo: [],
    inProgress: [],
    completed: [],
    isEstimating: false,
    dataSource: 'session' as const,
  }));
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
  jobType: string = 'code',
): Promise<KanbanData> {
  const url = `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/kanban?jobId=${encodeURIComponent(jobId)}&type=${encodeURIComponent(jobType)}`;
  return apiGet<KanbanData>(url).catch(() => ({
    jobId,
    todo: [],
    inProgress: [],
    completed: [],
    isEstimating: false,
    dataSource: 'session' as const,
  }));
}
