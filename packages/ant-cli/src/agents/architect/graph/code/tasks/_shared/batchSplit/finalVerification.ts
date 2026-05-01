import { TASK_PRIORITIES } from '../../../state';
import { CodeTask } from '../../../../../types/task';

/**
 * Final-priority gate already present in queue/running, or any completed
 * verification task. Module-private to `tasks/_shared/batchSplit/`.
 */
export function hasFinalVerification(
  queue: readonly CodeTask[],
  running: readonly CodeTask[],
  completed: readonly CodeTask[],
): boolean {
  const inFinalPriority = (t: CodeTask): boolean =>
    t.priority === TASK_PRIORITIES.FINAL_VERIFICATION;
  if (queue.some(inFinalPriority)) return true;
  if (running.some(inFinalPriority)) return true;
  if (completed.some((t: CodeTask) => t.type === 'verification')) return true;
  return false;
}
