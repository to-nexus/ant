/**
 * verification/hooks/scheduling.ts — TaskSchedulingHook
 *
 * Final verification is always the last task in the queue. The drain-skip
 * logic in `parallel/TaskOrchestrator.ts` (previously a literal
 * `priority >= FINAL_VERIFICATION` check) now dispatches through
 * `classify(...).isFinal`.
 *
 * classify — per-task scheduling role:
 *   - isFinal — priority >= FINAL_VERIFICATION (1000). When set, the
 *     orchestrator (a) marks the task as "drain skip on predecessor
 *     failure" target, and (b) templates render the final-verification
 *     variant (via `currentTaskIsFinal` template var injected at
 *     `buildMessages.ts`).
 *
 * No consumer/producer boolean flags — verification is the
 * queue-terminal marker, not a barrier producer/consumer for other types.
 */

import type { BaseTask } from '@ant/shared';
import type { SchedulingClassification } from '../../_shared/types';
import { TASK_PRIORITIES } from '../../../state';

export function classify(task: Pick<BaseTask, 'priority'>): SchedulingClassification {
  return {
    isFinal: task.priority >= TASK_PRIORITIES.FINAL_VERIFICATION,
  };
}
