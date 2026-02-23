/**
 * Task Classification Utilities
 * 
 * Shared logic for determining task types across graph nodes and routers.
 */

import { TASK_PRIORITIES } from '../state';

/**
 * Determine whether a task is a verification-class task.
 * 
 * Covers:
 * - Verification tasks (type = 'verification')
 * - Final verification tasks (priority >= 1000)
 * - Error tasks (type = 'error')
 * - Tasks with verification-related keywords in their name
 */
export function isVerificationTask(task: {
  priority?: number;
  type?: string;
  name?: string;
}): boolean {
  if (task.type === 'verification') return true;
  if (task.priority != null && task.priority >= TASK_PRIORITIES.FINAL_VERIFICATION) return true;
  if (task.type === 'error') return true;
  const name = task.name?.toLowerCase() || '';
  return ['final', 'integration', 'verification'].some(k => name.includes(k));
}

/**
 * Determine whether a task is specifically the final verification task.
 * Matches type = 'verification' OR priority >= 1000.
 */
export function isFinalVerificationTask(task: {
  priority?: number;
  type?: string;
  name?: string;
}): boolean {
  if (task.type === 'verification') return true;
  return task.priority != null && task.priority >= TASK_PRIORITIES.FINAL_VERIFICATION;
}
