/**
 * verification/hooks/scheduling.ts — TaskSchedulingHook
 *
 * Three-Axis SSOT: verification is type-fixed — every verification task
 * IS a final verification task. The "non-final verification" task does
 * not exist in this system (see `tasks/verification/model/is.ts`).
 * Classify ignores its argument and always reports `isFinal: true`.
 *
 * The drain-skip logic in `parallel/TaskOrchestrator.ts` and the
 * `currentTaskIsFinal` template var in `buildMessages.ts` both dispatch
 * through this flag. No consumer/producer boolean flags — verification
 * is the queue-terminal marker, not a barrier producer/consumer for
 * other types.
 */

import type { SchedulingClassification } from '../../_shared/types';

export function classify(): SchedulingClassification {
  return { isFinal: true };
}
