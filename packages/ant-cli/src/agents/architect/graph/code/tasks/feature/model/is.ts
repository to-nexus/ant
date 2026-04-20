/**
 * feature/model/is.ts — minimal classifier for feature-typed tasks.
 *
 * Used by the phase layer (`nodes/decompose/responseParser.ts`,
 * `nodes/decompose/sessionManager.ts`, `graph.ts`) to keep the
 * `task.type === 'feature'` comparison out of the blind layers (R1).
 *
 * Feature tasks carry no cross-phase Session, so this `model/` only hosts a
 * predicate. For exclusive dispatch the phase layer uses
 * `hooksForTaskType(task.type)?.decompose?.isExclusive(task)` instead (see
 * `feature/hooks/decompose.ts`).
 */

import type { CodeTask } from '../../../../../types/task';

/** True when a task represents an ordinary feature implementation task. */
export function isFeatureTask(task: { type?: string } | null | undefined): task is CodeTask {
  return (task as { type?: string } | null | undefined)?.type === 'feature';
}
