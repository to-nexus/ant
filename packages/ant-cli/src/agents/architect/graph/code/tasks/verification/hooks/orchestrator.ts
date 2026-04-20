/**
 * verification/hooks/orchestrator.ts — TaskOrchestratorHook
 *
 * Replaces the four verification-specific branches in
 * `parallel/TaskOrchestrator.ts` + `parallel/TaskWorker.ts` that read and
 * write legacy resume-state fields directly:
 *
 *   - Orchestrator attempt counter (`isVerificationTask ? resumeState._verificationAttempts : ...`)
 *   - Transient-failure snapshot attachment (`(task as any).resumeState = snapshot`)
 *   - "Capture snapshot on failure" policy flag
 *   - Worker `executeTask` restore-block (4 fields restored by hand)
 *
 * After T6, the orchestrator loops over `hooksForTaskType(task.type)?.orchestrator?.*`
 * for each task and never references `_verificationAttempts` /
 * `_verificationTracker` / `_appliedPlanHistory` / `_depFileHash` by name.
 *
 * The shape used on `task.resumeState.verification` is `VerificationSnapshot`
 * (see `model/snapshot.ts`). `resume` is typed `unknown` at the interface
 * boundary; this module performs the narrow check.
 */

import type { CodeTask } from '../../../../../types/task';
import { VerificationSession } from '../model/Session';
import type { VerificationSnapshot } from '../model/snapshot';

/** True — verification owns a unified attempt counter on the session. */
export const hasOwnAttemptCounter = true;

/** True — transient failures must capture a snapshot before re-queue. */
export const captureOnFailure = true;

function readSnapshot(task: CodeTask): VerificationSnapshot | undefined {
  const resume = (task as { resumeState?: { verification?: unknown } }).resumeState;
  const snap = resume?.verification;
  if (!snap || typeof snap !== 'object') return undefined;
  return snap as VerificationSnapshot;
}

/**
 * Attempt count for terminal / retry decisions. Falls back to `0` when no
 * verification snapshot has been attached yet (fresh task).
 */
export function attemptCount(task: CodeTask): number {
  const snap = readSnapshot(task);
  if (snap && typeof snap.attempts === 'number') return snap.attempts;
  // Legacy path — before T6 populates `resumeState.verification`, the
  // orchestrator's old code path used `resumeState._verificationAttempts`.
  const legacy = (task as { resumeState?: { _verificationAttempts?: number } })
    .resumeState?._verificationAttempts;
  return typeof legacy === 'number' ? legacy : 0;
}

/**
 * Attach a verification snapshot to the task's `resumeState`. Creates the
 * `resumeState` container if the task was never suspended before. T6 replaces
 * the inline `(task as any).resumeState = snapshot` writes with a call to
 * this method.
 */
export function attachSnapshot(task: CodeTask, snap: unknown): void {
  if (!snap || typeof snap !== 'object') return;
  const mutableTask = task as { resumeState?: Record<string, unknown> };
  if (!mutableTask.resumeState) {
    mutableTask.resumeState = {};
  }
  mutableTask.resumeState.verification = snap;
}

/**
 * Populate worker graph state from a resumed snapshot. Runs at worker
 * startup so downstream phases see a rehydrated `VerificationSession` on
 * `state.verification` from the very first node entry.
 */
export function restoreIntoWorkerState(
  workerState: Record<string, unknown>,
  resume: unknown,
): void {
  if (!resume || typeof resume !== 'object') return;
  const snap = resume as VerificationSnapshot;
  workerState.verification = VerificationSession.rehydrate(snap);
}
