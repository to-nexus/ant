/**
 * `_shared/verify/orchestrator` — TaskOrchestratorHook fields shared by
 * every verification responsibility holder.
 *
 * SSOT: previously `tasks/verification/hooks/orchestrator.ts`. Moved
 * here because the attempt counter is `Session.attempts()`-based — a
 * shared fact, not a verification-task-type-specific one. Self-verify
 * Tier 2 tasks must use the same counter once they enter verify-mode so
 * `_failedAttempts` shared-fallback logic does not fire spuriously
 * against a session that already tracks its own attempts.
 *
 * Owns:
 *   - Unified attempt counter (`hasOwnAttemptCounter` + `attemptCount`) —
 *     reads from `resumeState.verification.attempts` instead of the
 *     shared `retries` counter.
 *   - Worker-graph restore (`restoreIntoWorkerState`) — rebuilds
 *     `state.verification` from `resumeState.verification` at worker
 *     startup so the plan / tool / check hooks observe the persisted
 *     cycle from the very first node entry.
 *
 * Snapshot *capture* / *attach* stays task-type-blind: the orchestrator
 * writes the full `WorkerSnapshot` onto `task.resumeState` at every
 * carry-over boundary because cross-task fields (planText / conversations
 * / retries / violations / enforcementHistory) must be preserved
 * regardless of `task.type`. Restore is the only asymmetric side because
 * it has to revive the session *instance* from its plain-object snapshot
 * projection.
 *
 * `TaskOrchestrator` / `TaskWorker` dispatch via the per-bundle hook
 * (which `composeBundle` populates only when `requiresVerification(task)`
 * is true) and never know this module exists — the code-graph layer
 * stays blind to `task.type` (R1).
 */

import type { CodeTask } from '../../../../types/task';
import type { ArchitectGraphState } from '../../../state';
import { VerificationSession } from './Session';
import type { VerificationSnapshot } from './snapshot';
import { markVerifyEntered } from './markVerifyEntered';

/** True — verification responsibility holders own a unified attempt counter. */
export const hasOwnAttemptCounter = true;

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
 * Populate worker graph state from a resumed snapshot. Runs at worker
 * startup so downstream phases see a rehydrated `VerificationSession` on
 * `state.verification` from the very first node entry.
 *
 * Also restores `_verifyEntered=true` because the snapshot itself is the
 * runtime witness that the task crossed into verify-mode at least once
 * before the interruption. Without this restoration, a Tier 2 self-verify
 * task interrupted mid-reverify would resume with `_verifyEntered=false`,
 * which would route the next plan/execute through the apply-phase hooks
 * (the dispatch wrappers in `composeBundle` gate on `isVerifyEntered(state)`).
 * The verification task's behaviour is unaffected because its plan node's
 * `initSession` flips the flag at the first fresh-entry anyway, but the
 * restoration is symmetric across both task identities.
 */
export function restoreIntoWorkerState(
  workerState: Record<string, unknown>,
  resume: unknown,
): void {
  if (!resume || typeof resume !== 'object') return;
  const snap = resume as VerificationSnapshot;
  workerState.verification = VerificationSession.rehydrate(snap);
  // Use the canonical writer helper so the single-writer regression
  // guard (`tests/verification/unit/selfVerifyShared.test.ts`) stays
  // green without listing this file as an exception.
  markVerifyEntered(workerState as ArchitectGraphState);
}
