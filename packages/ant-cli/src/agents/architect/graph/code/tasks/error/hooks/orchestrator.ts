/**
 * error/hooks/orchestrator.ts — TaskOrchestratorHook.onTaskComplete
 *
 * Replaces the two duplicated `task.type === 'error'` auto-add-final-
 * verification branches previously inlined in `graph.ts`:
 *
 *   - L309~331 — sequential checkTaskStatus path (after a task is marked
 *     complete, push a Final Verification (Recheck) task when no final
 *     verification already exists anywhere in the pipeline).
 *   - L512~530 — parallelOrchestrator onTaskComplete callback (same
 *     guarantee in the parallel path).
 *
 * Both sites share the same intent ("error task done, make sure a build /
 * test recheck follows"). Centralising that decision here removes the
 * task-type branch from the phase layer (R1) and keeps the error-family
 * logic in one file (R2).
 *
 * The caller feeds a pre-materialised snapshot of the queue / running /
 * completed task lists; we never touch the live queue in-place for the
 * guard checks. Final task is pushed via the provided `taskQueue.push`.
 */

import type { CodeTask } from '../../../../../types/task';
import type { TechTier } from '@ant/shared';
import type { TaskCompleteCtx } from '../../_shared/types';
import { TASK_PRIORITIES } from '../../../state';

function hasFinalVerification(
  queue: readonly CodeTask[],
  running: readonly CodeTask[],
  completed: readonly CodeTask[],
): boolean {
  const inFinalPriority = (t: CodeTask): boolean =>
    t.priority === TASK_PRIORITIES.FINAL_VERIFICATION;
  if (queue.some(inFinalPriority)) return true;
  if (running.some(inFinalPriority)) return true;
  // The parallel orchestrator's legacy check treats any completed
  // verification task as evidence the final recheck already ran; keep
  // that semantic so behaviour is equivalent to the inline branch.
  if (completed.some((t: CodeTask) => t.type === 'verification')) return true;
  return false;
}

export function onTaskComplete(ctx: TaskCompleteCtx): void {
  const { task, taskQueue, queueSnapshot, runningSnapshot, completedSnapshot, resolvedAction } = ctx;
  if (!taskQueue) return;
  if (task.type !== 'error') return;

  if (hasFinalVerification(queueSnapshot, runningSnapshot, completedSnapshot)) return;

  const techTiers: TechTier[] = [
    resolvedAction?.basis?.techTier?.frontend,
    resolvedAction?.basis?.techTier?.backend,
  ].filter((t): t is TechTier => !!t);

  const finalTask: CodeTask = {
    id: `final-verification-recheck-${Date.now()}`,
    name: 'Final Verification (Recheck)',
    type: 'verification',
    priority: TASK_PRIORITIES.FINAL_VERIFICATION,
    description: 'Re-verify all errors are resolved after error fixes',
    techTiers,
  };
  taskQueue.push(finalTask);
  console.log(`📋 Added Final Verification to confirm all errors resolved`);
}
