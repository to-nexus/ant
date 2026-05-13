import type { BaseTask } from '@ant/shared';

/**
 * SSOT — failed-task → queue persistence shape.
 *
 * Sets the marker trio (`interrupted` / `_failed` / `_failureReason`) that
 * drives the FE's combined Retry+Paused TaskCard. Every persistence writer
 * that flows a failed task back into `state.taskQueue` (session file, Redis
 * checkpoint snapshot, post-orchestrator reconciliation) MUST route through
 * this helper so the marker shape stays uniform across code and design jobs.
 *
 * Task-type-specific axes (CodeTask's `batchSplitCount` / `_failedAttempts`
 * verification budget reset) are layered on top by a per-job wrapper. The
 * base only owns the markers that are declared on `BaseTaskCommon`.
 */
export function buildResumableFailedTaskBase<T extends BaseTask>(
  task: T,
  errorMessage: string,
): T {
  // `_failed`/`_failureReason` are runtime-only markers, not on the
  // discriminated union. `unknown` cast preserves the task discriminator
  // while bypassing excess-property checks.
  return {
    ...task,
    interrupted: true,
    _failed: true,
    _failureReason: errorMessage,
  } as unknown as T;
}
