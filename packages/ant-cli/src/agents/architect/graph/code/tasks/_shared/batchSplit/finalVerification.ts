import { CodeTask } from '../../../../../types/task';
import { isVerificationTask } from '../../verification';

/**
 * Final-priority gate already present in queue/running, or any completed
 * verification task. Module-private to `tasks/_shared/batchSplit/`.
 *
 * Three-Axis SSOT: verification is type-fixed — `task.type === 'verification'`
 * is the canonical predicate (with priority=1000 alias for legacy tasks).
 */
export function hasFinalVerification(
  queue: readonly CodeTask[],
  running: readonly CodeTask[],
  completed: readonly CodeTask[],
): boolean {
  if (queue.some(isVerificationTask)) return true;
  if (running.some(isVerificationTask)) return true;
  if (completed.some(isVerificationTask)) return true;
  return false;
}
