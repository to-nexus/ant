import type { CodeTask } from '../../../types/task';

/**
 * Build the persisted shape for a permanently-failed task that the user
 * is allowed to resume. Resets task-owned VerificationBudget axes
 * (`batchSplitCount`, `_failedAttempts`) so the next user-resume gets
 * a fresh budget — without this, a task that hit `batch_cycle_limit`
 * fails again on the very first batch_split attempt of the resumed run
 * (vast-curling-perch incident).
 *
 * SSOT for the resume-after-tasks_failed boundary. Every persistence
 * writer that flows back into `taskQueue` (session file, Redis
 * checkpoint snapshot, post-orchestrator session reconciliation) MUST
 * route through this helper. Drift between writers re-opens the bug —
 * `JobCleanupManager` prefers the Redis checkpoint as parallel-mode
 * SSOT, so even a single writer that skips the reset wins.
 *
 * Preserves: the rest of `task` (id / name / type / priority / techTiers
 * / resumeState …), plus `interrupted: true` / `_failed: true` /
 * `_failureReason` markers. The marker trio drives the UI's paused
 * TaskCard and is cleared by `TaskOrchestrator.assignTask` on retry.
 *
 * Why NOT reset `state.retries`? `retries` is state-owned (per-task,
 * cleared on task boundary by the existing graph flow). Only the
 * task-owned axes need explicit cross-resume reset.
 *
 * Why NOT reset budgets at the in-session Path A re-queue inside
 * `batchSplit/process.ts`? That re-queue intentionally preserves the
 * counters — resetting there causes infinite retry (`re-queue retry-budget reset`
 * incident). This helper guards the OTHER boundary (cross-process
 * resume after permanent failure).
 */
export function buildResumableFailedTask(
  task: CodeTask,
  errorMessage: string,
): CodeTask {
  // `_failed`/`_failureReason`/`_failedAttempts` are runtime-only state
  // markers (UI render gate + orchestrator retry counter), not declared
  // on the discriminated union. `unknown` cast bypasses excess-property
  // checks while preserving the parent task's type/discriminator.
  return {
    ...task,
    interrupted: true,
    _failed: true,
    _failureReason: errorMessage,
    batchSplitCount: 0,
    _failedAttempts: 0,
  } as unknown as CodeTask;
}

/**
 * Load-boundary safety net for the resume flow. When `runner.ts`
 * reconstructs `state.taskQueue` from the persisted session file, run
 * every task through this normalizer — any task carrying the strict
 * permanent-fail signal (`_failed === true`) gets its
 * VerificationBudget task-owned axes reset to 0.
 *
 * Why this exists alongside the save-side `buildResumableFailedTask`:
 * even with every persistence writer routed through the helper, a
 * single drifted writer (or stale state from a pre-fix code version
 * still on disk) can re-leak a non-zero counter. Resetting at the load
 * boundary makes the resume-after-permanent-fail contract idempotent
 * regardless of where the saved state originated.
 *
 * Strict trigger: `_failed === true` ONLY. We DO NOT reset on
 * `interrupted: true` alone — that flag covers mid-run pauses
 * (recursion_limit / user_stopped) where the original budget MUST be
 * preserved across the boundary so the orchestrator's retry logic
 * stays sane. Permanent-fail saves always set `_failed: true`
 * alongside `interrupted: true` (see `buildResumableFailedTask`), so
 * the strict gate cleanly separates the two boundaries.
 *
 * Idempotent: applying twice is a no-op (the already-zero values stay
 * zero). Pure: returns a new array; never mutates the input.
 */
export function normalizeResumedQueueBudgets(tasks: CodeTask[]): CodeTask[] {
  return tasks.map(t => {
    if ((t as { _failed?: boolean })._failed === true) {
      return { ...t, batchSplitCount: 0, _failedAttempts: 0 } as unknown as CodeTask;
    }
    return t;
  });
}
