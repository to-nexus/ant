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
 * The retired `planHistoryBodies` and `previousBatchDiagnostics` channels
 * (verification fix-책임 제거 리팩토링) are intentionally absent from this
 * shape. Old snapshots carrying those fields are silently ignored at
 * rehydrate time — `Session.rehydrate` only reads the fields it knows.
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
   * Monotonic count of plan re-entries (reverify + batch-split fan-outs).
   * Drives deep-diagnostic / terminal decisions.
   */
  attempts: number;
  /**
   * Stable SHA-1 hashes of the plans that have been applied so far.
   * Used for cheap repeated-plan detection without storing bodies.
   */
  planHistoryHashes: string[];
  /**
   * Last observed install status (from `areDepsInstalled`). Lives on the
   * snapshot so a batch-split re-queue starts with the pre-split observation
   * as its initial cache instead of walking node_modules again. Always
   * re-verified by the next plan entry's `recomputeInstallNeeded` call.
   */
  installNeeded?: boolean;
  /** Total batch-split cycles this verification task has triggered. */
  batchSplitCount?: number;
}

/** Empty snapshot used as the rehydration target for fresh sessions. */
export const EMPTY_SNAPSHOT: VerificationSnapshot = Object.freeze({
  required: [],
  passed: [],
  attempts: 0,
  planHistoryHashes: [],
});
