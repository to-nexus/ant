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
