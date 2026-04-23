/**
 * error/hooks/orchestrator.ts — TaskOrchestratorHook.onTaskComplete
 *
 * Defense-in-depth fallback under the Tier-Verification Alignment SSOT.
 *
 * Primary path (decompose prompt SSOT):
 *   - Tier 2 error task: ships with `selfVerifyOnDone: true` — the single
 *     task owns its own install/typecheck/build/test gates inline. No
 *     subsequent Final Verification is needed, and this hook is a NOOP for
 *     Tier 2 tasks (gated by the `selfVerifyOnDone` check below).
 *   - Tier 3/4 error task(s): decompose MUST emit a dedicated verification
 *     task (priority 1000). `responseParser.createTaskQueue` now enforces
 *     this at decompose time via the `executionTier >= 3 && !hasFinalTask`
 *     throw. Under the primary path, Final Verification is already queued
 *     by the time any error task completes, and this hook observes
 *     `hasFinalVerification === true` and returns early.
 *
 * Fallback path (this hook):
 *   - If the decompose LLM violates the SSOT and emits Tier 3/4 error task(s)
 *     without a Final Verification, `responseParser.createTaskQueue` throws
 *     at decompose time. This hook only fires if a pre-alignment session
 *     resumes (Tier 3 error task WITHOUT Final Verification in queue), and
 *     then it auto-enqueues one as a recovery signal so the pipeline
 *     terminates in a verified state. The console.warn surfaces the
 *     violation so it is visible in logs, rather than silently papering over
 *     a regression.
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

  // Tier-Verification Alignment: Tier 2 error tasks own inline self-verify.
  // Auto-enqueueing a Final Verification here would double-verify the same
  // single-unit work and violate the "tasks.length === 1" invariant of
  // Tier 2. NEVER fire for Tier 2 (detected via selfVerifyOnDone).
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
