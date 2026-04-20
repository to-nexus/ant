/**
 * VerificationSnapshot — persistent, JSON-friendly projection of
 * `VerificationSession` state.
 *
 * The snapshot is what crosses every carry-over boundary:
 *   - `handleInterruption` → `task.resumeState`
 *   - `reportFailure` (transient) → `task.resumeState`
 *   - `plan.processDiagnosticBatchSplit` → `requeuedTask.resumeState`
 *
 * `VerificationSession.snapshot()` is the only producer; `rehydrate()` is
 * the only consumer. All fields are optional so partial snapshots (e.g.
 * a fresh verification task with no history) remain valid.
 *
 * R2 — model-only module; does not import from `nodes/`, `routers/`, or
 * `parallel/`. `Gate` is the single external name used.
 */

import type { Gate } from './gates';

export interface VerificationSnapshot {
  /** Gates the task must pass. Derived from environment at creation. */
  required: Gate[];
  /** Gates that have passed in the current diagnostic cycle. */
  passed: Gate[];
  /**
   * Gates that have been attempted at least once in the current cycle.
   * Cleared on retry/reverify entry so the plan tool loop can try each
   * gate again with fresh evidence.
   */
  attemptedThisCycle: Gate[];
  /**
   * Monotonic count of plan re-entries (retry + reverify + orchestrator
   * re-queue). Drives budget / deep-diagnostic / terminal decisions.
   */
  attempts: number;
  /**
   * Stable SHA-1 hashes of the plans that have been applied so far.
   * Used for cheap repeated-plan detection without storing bodies.
   */
  planHistoryHashes: string[];
  /**
   * Most recent plan bodies (bounded, keeps the last 3). Injected into the
   * plan prompt so the LLM can see what it already tried and avoid
   * verbatim repetition.
   */
  planHistoryBodies?: string[];
  /** Hash of dependency files at last successful install. */
  depHash?: string;
  /** Whether a `{pm} install` needs to be run before the next gate command. */
  installNeeded?: boolean;
  /** Total batch-split cycles this verification task has triggered. */
  batchSplitCount?: number;
  /**
   * JSON summary of the previous batch-split diagnostics. Injected into
   * the follow-up LLM prompt so it can avoid re-triggering the same split.
   */
  previousBatchDiagnostics?: string;
}

/** Empty snapshot used as the rehydration target for fresh sessions. */
export const EMPTY_SNAPSHOT: VerificationSnapshot = Object.freeze({
  required: [],
  passed: [],
  attemptedThisCycle: [],
  attempts: 0,
  planHistoryHashes: [],
});
