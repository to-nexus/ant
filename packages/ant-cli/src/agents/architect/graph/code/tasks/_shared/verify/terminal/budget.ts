/**
 * `_shared/verify/terminal/budget` — VerificationBudget aggregate.
 *
 * Single read+write surface for the axes that determine "should this
 * verification cycle continue?".
 *
 * R2 — depends only on the graph state shape, CodeTask type, and the
 * `batchSplit` cycle-limit constant.
 */

import type { ArchitectGraphState } from '../../../../state';
import type { CodeTask } from '../../../../../../types/task';
import { MAX_BATCH_SPLIT_CYCLES } from '../../batchSplit/cycleLimit';

/**
 * JSON-friendly read-only projection of every budget axis.
 *
 *   - `planRetries`     — state-owned (per-task; reset on task boundary).
 *   - `orchestratorFails` — task-owned (`task._failedAttempts`; preserved
 *     across re-queue, reset only on permanent fail).
 *   - `batchSplits`     — task-owned (`task.batchSplitCount`; carried via
 *     `task.resumeState` round-trip across batch-split re-queue).
 */
export interface BudgetSnapshot {
  planRetries: number;
  orchestratorFails: number;
  batchSplits: number;
}

/**
 * Per-axis thresholds. Centralised so all "give up" gates are
 * cross-referenceable in one place.
 */
export const BUDGET_THRESHOLDS = {
  MAX_TASK_RETRIES: 2,
  MAX_BATCH_SPLIT_CYCLES,
} as const;

/**
 * First-hit terminal reason. Caller decides whether/how to throw.
 * `null` means "no axis exceeded yet".
 */
export type TerminalReason =
  | { kind: 'max_retries_exceeded'; threshold: number; current: number }
  | { kind: 'batch_cycle_limit'; threshold: number; current: number }
  | { kind: 'orchestrator_fail_limit'; threshold: number; current: number }
  | null;

/** Aggregate of the budget axes. Static methods — no instance state. */
export class VerificationBudget {
  static fromState(state: ArchitectGraphState, task?: CodeTask): BudgetSnapshot {
    const t = (task ?? state.currentTask) as
      | { _failedAttempts?: number; batchSplitCount?: number }
      | undefined;
    return {
      planRetries: state.retries ?? 0,
      orchestratorFails: t?._failedAttempts ?? 0,
      batchSplits: t?.batchSplitCount ?? 0,
    };
  }

  /**
   * First-hit terminal predicate. Returns the first axis that exceeded
   * its threshold, or `null`. Pure — caller throws.
   */
  static shouldGiveUp(
    snap: BudgetSnapshot,
    ctx: { maxRetries?: number },
  ): TerminalReason {
    const maxRetries = ctx.maxRetries ?? Number.POSITIVE_INFINITY;
    if (snap.planRetries >= maxRetries) {
      return { kind: 'max_retries_exceeded', threshold: maxRetries, current: snap.planRetries };
    }
    if (snap.batchSplits > BUDGET_THRESHOLDS.MAX_BATCH_SPLIT_CYCLES) {
      return {
        kind: 'batch_cycle_limit',
        threshold: BUDGET_THRESHOLDS.MAX_BATCH_SPLIT_CYCLES,
        current: snap.batchSplits,
      };
    }
    if (snap.orchestratorFails >= BUDGET_THRESHOLDS.MAX_TASK_RETRIES) {
      return {
        kind: 'orchestrator_fail_limit',
        threshold: BUDGET_THRESHOLDS.MAX_TASK_RETRIES,
        current: snap.orchestratorFails,
      };
    }
    return null;
  }

  /**
   * Prospective batch-split count assuming a successful next bump. Used
   * by the cycle-limit terminal check that runs BEFORE the bump so the
   * snapshot captured by the throw sees the right value.
   */
  static peekNextBatchSplit(state: ArchitectGraphState, task?: CodeTask): number {
    const t = (task ?? state.currentTask) as { batchSplitCount?: number } | undefined;
    return (t?.batchSplitCount ?? 0) + 1;
  }

  static isBatchSplitCycleLimitExceeded(state: ArchitectGraphState, task?: CodeTask): boolean {
    return VerificationBudget.peekNextBatchSplit(state, task) > BUDGET_THRESHOLDS.MAX_BATCH_SPLIT_CYCLES;
  }

  /** Plan retry bump → `state.retries += 1`. Returns the new value. */
  static bumpPlanRetry(state: ArchitectGraphState): number {
    state.retries = (state.retries ?? 0) + 1;
    return state.retries;
  }

  /**
   * Orchestrator-level failure bump → `task._failedAttempts += 1`.
   * Verification responsibility holders use the same axis as every other
   * task (the `hasOwnAttemptCounter` orchestrator slot was retired).
   */
  static bumpOrchestratorFail(task: { _failedAttempts?: number }): number {
    const next = (task._failedAttempts ?? 0) + 1;
    task._failedAttempts = next;
    return next;
  }
}
