/**
 * error/hooks/orchestrator.ts — TaskOrchestratorHook.onTaskComplete
 *
 * Defense-in-depth fallback under the Tier-Verification Alignment SSOT.
 *
 * Primary paths (decompose / batchSplit SSOT):
 *   - Tier 2 error task (decompose-time `selfVerifyOnDone:true`): runs
 *     a two-cycle apply→reverify lifecycle within the same task. The
 *     reverify cycle uses the shared `_shared/verify/` infrastructure
 *     (Session, plan/execute/command/check/router) to enforce gates.
 *     By the time `onTaskComplete` fires, all gates have already passed
 *     (the task only completes after `Session.isComplete()`). No
 *     subsequent Final Verification is needed, and this hook is a NOOP
 *     for Tier 2 tasks (gated by the `selfVerifyOnDone` check below).
 *   - Tier 2 escalate / Tier 3+ error batch-split (batchSplit Path B):
 *     `batchSplit.ts` drops the original task and enqueues N sub-tasks
 *     (type inherits parent for Tier 2 escalate, 'error' for Tier 3+
 *     error parents per the verification-plan semantic) plus a Final
 *     Verification at priority 1000 when none is already queued. Sub-
 *     tasks therefore complete with a Final Verification already in
 *     queue, and this hook's `hasFinalVerification` guard returns early.
 *   - Tier 3/4 error task(s): decompose MUST emit a dedicated verification
 *     task (priority 1000). `responseParser.createTaskQueue` enforces this
 *     at decompose time via the `executionTier >= 3 && !hasFinalTask`
 *     throw. Under the primary path, Final Verification is already queued
 *     by the time any error task completes, and this hook observes
 *     `hasFinalVerification === true` and returns early.
 *
 * Fallback path (this hook):
 *   - Fires only when none of the primary paths above have queued a Final
 *     Verification. Historically this covers pre-alignment sessions that
 *     resumed with Tier 3 error tasks but no Final Verification. The
 *     console.warn surfaces the regression so it is visible in logs rather
 *     than silently papering over the SSOT violation.
 *
 * Historically this hook replaced two duplicated inline branches in
 * `graph.ts` (sequential checkTaskStatus + parallelOrchestrator onTaskComplete).
 * Centralising kept the task-type branch out of the phase layer (R1). Under
 * Tier-Verification Alignment the primary trigger is gone, but the
 * centralisation property is still worth preserving — hence the demotion to
 * a logged safety net rather than outright removal.
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

  // Tier-Verification Alignment: Tier 2 error tasks own a two-cycle
  // apply→reverify lifecycle within the same task (verify-mode dispatched
  // through `_shared/verify/` after `executeRouter.routeAfterDone` flips
  // `_verifyEntered=true`). By the time onTaskComplete fires the task has
  // already passed every gate via `Session.isComplete()` — auto-enqueueing
  // a Final Verification would double-verify the same single-unit work
  // and violate the "tasks.length === 1" invariant of Tier 2. NEVER fire
  // for Tier 2 (detected via selfVerifyOnDone — the decompose-time marker).
  if ((task as any).selfVerifyOnDone === true) return;

  if (hasFinalVerification(queueSnapshot, runningSnapshot, completedSnapshot)) return;

  // Reaching this branch means Tier 3/4 shipped error task(s) without a
  // Final Verification — decompose's SSOT guard should have rejected this at
  // responseParser.createTaskQueue time. Surface the violation loudly; the
  // auto-add keeps the pipeline terminating in a verified state rather than
  // papering over the regression silently.
  console.warn(
    `⚠️  [Prompt Violation Fallback] Final Verification auto-added after error task ` +
      `"${task.id ?? task.name}" — decompose failed to emit one at Tier 3/4. ` +
      `Under Tier-Verification Alignment SSOT this auto-enqueue should never fire on the ` +
      `primary path; if you see this in logs, the decompose prompt / responseParser guard ` +
      `has regressed and needs investigation.`,
  );

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
  console.log(`📋 Added Final Verification to confirm all errors resolved (fallback)`);
}
