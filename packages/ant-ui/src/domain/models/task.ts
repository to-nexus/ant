/**
 * Unified Task Type
 * 
 * This type consolidates both live queue data (parsed from logs)
 * and session data (from session.json) into a single interface.
 * 
 * Live data typically has: name, type, status, timing
 * Session data has: id, name, type, description, priority, etc.
 */

export interface UnifiedTask {
  // Core fields (always present)
  name: string;
  type: string;
  status?: string;
  
  // Session-specific fields (optional)
  id?: string;
  description?: string;
  priority?: number | 'low' | 'medium' | 'high' | 'critical'; // Support both formats
  dependencies?: string[];
  completed?: boolean;
  interrupted?: boolean;  // Whether this task was interrupted (stopped manually)
  
  // Live timing data (optional)
  timing?: {
    startedAt?: string;
    completedAt?: string;
    pausedAt?: string;
    resumedAt?: string;
    totalPausedDuration: number;
    elapsedTime?: number;
  };
  
  // Additional metadata
  assignee?: string;
  estimatedHours?: number;
  actualHours?: number;
  startedAt?: string;
  completedAt?: string;
  blockedReason?: string;
  notes?: string;
  tags?: string[];
}

/**
 * Normalizes a task from either live data or session data
 * into the UnifiedTask format
 */
export function normalizeTask(task: any): UnifiedTask {
  // If it's already a complete session task
  if (task.id && task.description) {
    return {
      ...task,
      name: task.name || task.id,
      type: task.type || 'unknown',
      status: task.status || (task.completed ? 'completed' : 'pending'),
    };
  }
  
  // If it's live queue data (minimal fields)
  return {
    name: task.name || 'Unknown Task',
    type: task.type || 'unknown',
    status: task.status || 'pending',
    timing: task.timing,
    // Preserve any additional fields
    ...task,
  };
}

/**
 * Normalizes an array of tasks
 */
export function normalizeTasks(tasks: any[]): UnifiedTask[] {
  return tasks.map(normalizeTask);
}
