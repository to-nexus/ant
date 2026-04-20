/**
 * verification/hooks/orchestrator.ts — TaskOrchestratorHook
 *
 * Owns verification-specific orchestrator behaviour:
 *
 *   - Unified attempt counter (`hasOwnAttemptCounter` + `attemptCount`) —
 *     reads from `resumeState.verification.attempts` instead of the
 *     shared `retries` counter.
 *   - Transient-failure snapshot attachment (`attachSnapshot`) — writes
 *     the session snapshot onto `task.resumeState.verification` so the
 *     next worker invocation rehydrates the cycle.
 *   - Worker-graph restore (`restoreIntoWorkerState`) — rebuilds
 *     `state.verification` from `resumeState.verification` at worker
 *     startup.
 *
 * `TaskOrchestrator` / `TaskWorker` dispatch via
 * `hooksForTaskType(task.type)?.orchestrator?.*` and never know this
 * module exists — the code-graph layer stays blind to `task.type` (R1).
 *
 * `VerificationSnapshot` (see `model/snapshot.ts`) is the only shape ever
 * stored on `task.resumeState.verification`; the `resume` argument is
 * typed `unknown` at the interface boundary and narrowed here.
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
  return 0;
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
