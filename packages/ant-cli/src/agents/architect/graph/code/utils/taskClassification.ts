/**
 * Task Classification Utilities
 * 
 * Shared logic for determining task types across graph nodes and routers.
 * Eliminates inconsistent detection between codeGenRouter (priority-based)
 * and installDeps (name-based).
 */

import { TASK_PRIORITIES } from '../state';

/**
 * Determine whether a task requires verification (installDeps → runtimeValidate flow).
 * 
 * Covers:
 * - Final verification tasks (priority >= 1000)
 * - Error tasks (type = 'error')
 * - Tasks with verification-related keywords in their name
 */
export function isVerificationTask(task: {
  priority?: number;
  type?: string;
  name?: string;
}): boolean {
  if (task.priority != null && task.priority >= TASK_PRIORITIES.FINAL_VERIFICATION) return true;
  if (task.type === 'error') return true;
  const name = task.name?.toLowerCase() || '';
  return ['final', 'integration', 'verification'].some(k => name.includes(k));
}

/**
 * Determine whether a task is specifically the final verification task
 * (not just any verification task — excludes error tasks).
 */
export function isFinalVerificationTask(task: {
  priority?: number;
  name?: string;
}): boolean {
  if (task.priority != null && task.priority >= TASK_PRIORITIES.FINAL_VERIFICATION) return true;
  const name = task.name?.toLowerCase() || '';
  return ['final', 'integration', 'verification'].some(k => name.includes(k));
}
