/**
 * Unified Task Type
 * 
 * This type consolidates both live queue data and session data
 * into a single interface for UI consumption.
 * 
 * Task types match backend TaskType from core/types/task.ts:
 * setup, feature, error, explain, doc
 */

import type { TaskTokenUsage, TaskTiming, TaskType } from '@ant/shared';

export interface UnifiedTask {
  // Core fields (always present)
  id: string;
  name: string;
  type: TaskType;
  priority: number;
  description: string;
  
  // Status
  status?: string;
  completed?: boolean;
  interrupted?: boolean;
  
  // Timing & tokens
  timing?: TaskTiming;
  tokenUsage?: TaskTokenUsage;

  // Package scope
  packages?: string[];
}

/**
 * Normalizes a task from either live data or session data
 * into the UnifiedTask format
 */
export function normalizeTask(task: Record<string, unknown>): UnifiedTask {
  return {
    id: (task.id as string) || '',
    name: (task.name as string) || 'Unknown Task',
    type: (task.type as TaskType) || 'feature',
    priority: (task.priority as number) || 0,
    description: (task.description as string) || '',
    status: (task.status as string) || (task.completed ? 'completed' : 'pending'),
    completed: task.completed as boolean | undefined,
    interrupted: task.interrupted as boolean | undefined,
    timing: task.timing as TaskTiming | undefined,
    tokenUsage: task.tokenUsage as TaskTokenUsage | undefined,
    packages: Array.isArray(task.packages) ? task.packages as string[] : undefined,
  };
}

/**
 * Normalizes an array of tasks
 */
export function normalizeTasks(tasks: Record<string, unknown>[]): UnifiedTask[] {
  return tasks.map(normalizeTask);
}
