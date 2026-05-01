/**
 * `_shared/verify/budget` — VerificationBudget aggregate.
 *
 * Single read AND write surface for the 5 axes that determine "should
 * this verification cycle continue?". Per-axis mutation sites are
 * unchanged (Session methods, state delta returns, orchestrator
 * bookkeeping); this module funnels every dispatch through one named
 * surface so the counter set is grep-discoverable in one place and the
 * read / write paths share the same vocabulary.
 *
 * R2 — depends only on sibling `_shared/verify/` modules + state shape +
 * task type + the batchSplit cycle-limit constant.
 */

import type { ArchitectGraphState } from '../../../state';
import type { CodeTask } from '../../../../../types/task';
import { isVerificationTask } from '../../verification';
import {
  onReverifyEntry as lifecycleReverify,
  onBatchSplit as lifecycleBatchSplit,
} from './sessionLifecycle';
import { MAX_BATCH_SPLIT_CYCLES } from '../batchSplit/cycleLimit';
import { DEEP_DIAGNOSTIC_THRESHOLD } from './Session';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Terminal threshold for `Session._attempts` (reverify cycles).
 *
 * The historical safety nets (Safety Net C / `state.retries` / orchestrator
 * `_failedAttempts`) all reset across re-routes, so a verify task that
 * never emits `<done>` can loop indefinitely while none of those axes
 * accumulate. `Session._attempts` IS monotonic across reverify cycles
 * and batch-split requeues, so it is the only axis that can serve as a
 * terminal escape for the missed-`<done>` pattern. Conservative default
 * (5) — `DEEP_DIAGNOSTIC_THRESHOLD` (2) flips deep-mode prompt; terminal
 * fires several cycles later only when the cycle is actually stuck.
 *
 * Env override: `ANT_MISSED_DONE_TERMINAL` (positive int).
 */
const MISSED_DONE_TERMINAL = envInt('ANT_MISSED_DONE_TERMINAL', 5);

/**
 * JSON-friendly read-only projection of every budget axis.
 *
 * `reverifyCycles` and `batchSplits` are Session-owned (carry across
 * batch-split → requeue via the snapshot). `planRetries` and
 * `finalLoopCount` are state-owned (per-task, reset on task boundary).
 * `orchestratorFails` is task-owned (preserved across requeue via the
 * verification path; reset only on permanent fail).
 */
export interface BudgetSnapshot {
  reverifyCycles: number;
  planRetries: number;
  orchestratorFails: number;
  batchSplits: number;
  finalLoopCount: number;
}

/**
 * Per-axis thresholds. Centralised here so all "give up" gates are
 * cross-referenceable without grepping multiple files.
 */
export const BUDGET_THRESHOLDS = {
  MAX_TASK_RETRIES: 2,
  MAX_BATCH_SPLIT_CYCLES,
  DEEP_DIAGNOSTIC_THRESHOLD,
  LOOP_VERIFY_WITH_PLAN: 2,
  LOOP_VERIFY_ONLY: 1,
  LOOP_GENERAL: 3,
  MISSED_DONE_TERMINAL,
} as const;

/**
 * First-hit terminal reason. Caller decides whether/how to throw.
 * `null` means "no axis exceeded yet".
 */
export type TerminalReason =
  | { kind: 'max_retries_exceeded'; threshold: number; current: number }
  | { kind: 'batch_cycle_limit'; threshold: number; current: number }
  | { kind: 'orchestrator_fail_limit'; threshold: number; current: number }
  | { kind: 'missed_done_loop'; threshold: number; current: number }
  | null;

/**
 * Aggregate of the 5 budget axes. Static methods — no instance state.
 */
export class VerificationBudget {
  /**
   * Read-only snapshot of every axis. The `task` argument defaults to
   * `state.currentTask`; pass an explicit task for paths where
   * `currentTask` may have already advanced (e.g. orchestrator failure
   * handler).
   */
  static fromState(state: ArchitectGraphState, task?: CodeTask): BudgetSnapshot {
    const t = (task ?? state.currentTask) as { _failedAttempts?: number } | undefined;
    return {
      reverifyCycles: state.verification?.attempts() ?? 0,
      planRetries: state.retries ?? 0,
      orchestratorFails: t?._failedAttempts ?? 0,
      batchSplits: state.verification?.batchSplitCount() ?? 0,
      finalLoopCount: state._finalTaskLoopCount ?? 0,
    };
  }

  /**
   * First-hit terminal predicate. Returns the first axis that exceeded
   * its threshold, or `null`. Pure — caller throws.
   *
   * The `missed_done_loop` axis (`reverifyCycles`) catches the case where
   * a verify task loops indefinitely without ever emitting `<done>`; the
   * other axes reset across re-routes and would otherwise never trigger.
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
    if (snap.reverifyCycles >= BUDGET_THRESHOLDS.MISSED_DONE_TERMINAL) {
      return {
        kind: 'missed_done_loop',
        threshold: BUDGET_THRESHOLDS.MISSED_DONE_TERMINAL,
        current: snap.reverifyCycles,
      };
    }
    return null;
  }

  /**
   * Safety Net C threshold (executeRouter). Verification + planText →
   * 2 (allow recovery from a thinking-only first call). Verification
   * without planText → 1. Non-verification → 3.
   */
  static loopThreshold(state: ArchitectGraphState, task?: CodeTask): number {
    const t = task ?? state.currentTask;
    const isVerification = t ? isVerificationTask(t) : false;
    if (!isVerification) return BUDGET_THRESHOLDS.LOOP_GENERAL;
    return state.planText
      ? BUDGET_THRESHOLDS.LOOP_VERIFY_WITH_PLAN
      : BUDGET_THRESHOLDS.LOOP_VERIFY_ONLY;
  }

  static isLoopThresholdReached(state: ArchitectGraphState, task?: CodeTask): boolean {
    return (state._finalTaskLoopCount ?? 0) >= VerificationBudget.loopThreshold(state, task);
  }

  /**
   * Prospective batch-split count assuming the next `bumpBatchSplit`.
   * Used by the cycle-limit terminal check that runs BEFORE the bump
   * so the snapshot captured by the throw sees the right value.
   */
  static peekNextBatchSplit(state: ArchitectGraphState): number {
    return (state.verification?.batchSplitCount() ?? 0) + 1;
  }

  static isBatchSplitCycleLimitExceeded(state: ArchitectGraphState): boolean {
    return VerificationBudget.peekNextBatchSplit(state) > BUDGET_THRESHOLDS.MAX_BATCH_SPLIT_CYCLES;
  }

  static isInDeepMode(state: ArchitectGraphState): boolean {
    return state.verification?.inDeepMode() ?? false;
  }

  /**
   * Compute the next `_finalTaskLoopCount` value: increment when the
   * caller decided the cycle is stuck (verify task without progress in
   * this turn), reset to 0 otherwise. Pure — caller commits the value
   * via the LangGraph reducer delta.
   */
  static computeFinalLoopCount(prev: number, isStuck: boolean): number {
    return isStuck ? prev + 1 : 0;
  }

  /** Reverify cycle bump → `Session._attempts += 1`. No-op without Session. */
  static bumpReverify(state: ArchitectGraphState): void {
    lifecycleReverify(state);
  }

  /** Plan retry bump → `state.retries += 1`. Returns the new value. */
  static bumpPlanRetry(state: ArchitectGraphState): number {
    state.retries = (state.retries ?? 0) + 1;
    return state.retries;
  }

  /**
   * Orchestrator-level failure bump → `task._failedAttempts += 1`.
   * Caller MUST gate on `hasOwnAttemptCounter === false` — verification
   * and Tier 2 self-verify own their counter via the Session.
   */
  static bumpOrchestratorFail(task: { _failedAttempts?: number }): number {
    const next = (task._failedAttempts ?? 0) + 1;
    task._failedAttempts = next;
    return next;
  }

  /**
   * Batch-split bump → `Session._batchSplitCount += 1` AND
   * `Session._attempts += 1` (atomically through `Session.onBatchSplit`).
   */
  static bumpBatchSplit(
    state: ArchitectGraphState,
    summary: {
      cycle: number;
      totalErrors: number;
      rootCauses: readonly unknown[];
      batchNames: readonly string[];
    },
  ): void {
    lifecycleBatchSplit(state, summary);
  }
}
