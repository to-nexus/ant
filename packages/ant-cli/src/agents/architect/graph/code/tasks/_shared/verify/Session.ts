/**
 * VerificationSession — the single authority for "where is this verification
 * cycle currently sitting?".
 *
 * Every query and mutation goes through this class so invariants
 * ("passed ⊆ required", "attempts ≥ 0", "repeated-plan derived from
 * history") cannot drift.
 *
 * SSOT location: previously `tasks/verification/model/Session.ts`. Moved to
 * `tasks/_shared/verify/` because the Session represents the state of a
 * verification responsibility, not the state of one specific task type.
 * Verification task type and any `selfVerifyOnDone:true` task share this
 * identical state machine.
 *
 * R2 — model-only. Does not import from `nodes/`, `routers/`, or `parallel/`.
 *
 * Environment:
 *   - `ANT_DEEP_DIAGNOSTIC_THRESHOLD` — attempts at which deep-diagnostic mode activates (default 2).
 */

import type { Gate } from './gates';
import { GATE_ORDER } from './gates';
import type { VerificationSnapshot } from './snapshot';
import { EMPTY_SNAPSHOT } from './snapshot';
import { countRepeatedHash, normalizePlanForHash } from './planHash';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const DEEP_DIAGNOSTIC_THRESHOLD = envInt('ANT_DEEP_DIAGNOSTIC_THRESHOLD', 2);

// ────────────────────────────────────────────────────────────────────────────
// Plan-entry vocabulary
// ────────────────────────────────────────────────────────────────────────────

/**
 * Re-export of the phase-agnostic plan-entry union. The single source of
 * truth lives in `tasks/_shared/types.ts`; re-exporting here keeps hook
 * code (which imports from this module) decoupled from the `_shared/`
 * layer while guaranteeing the union cannot drift between the two
 * declarations (a previous local copy was deleted in the T4 review).
 */
import type { PlanEntry } from '../types';
export type { PlanEntry };

// ────────────────────────────────────────────────────────────────────────────
// Constructor input
// ────────────────────────────────────────────────────────────────────────────

export interface VerificationSessionEnv {
  /** Static type checking is part of this task's gate set. */
  isTs: boolean;
  /** At least one test file is present; the `test` gate is required. */
  hasTests: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Session
// ────────────────────────────────────────────────────────────────────────────

/**
 * Mutable verification-session aggregate. Constructed via `createFresh` (new
 * task) or `rehydrate` (resume from snapshot). Every mutation is expressed
 * as a named method; direct field access is not part of the API.
 */
export class VerificationSession {
  // Internal mutable state. `readonly` on the class field prevents swapping
  // out the whole Set; the Sets themselves are mutated in place.
  private readonly _required: Set<Gate>;
  private readonly _passed: Set<Gate>;
  // `_planHistoryHashes` is retained as the SSOT for repeated-plan
  // detection. The body buffer + previousBatchDiagnostics narrative
  // channels were removed when verification stopped owning fix
  // responsibility (see "verification fix-책임 제거 리팩토링").
  private readonly _planHistoryHashes: string[];

  private _attempts: number;
  private _installNeeded: boolean | undefined;
  private _batchSplitCount: number;

  private constructor(init: {
    required: Iterable<Gate>;
    passed: Iterable<Gate>;
    attempts: number;
    planHistoryHashes: string[];
    installNeeded?: boolean;
    batchSplitCount?: number;
  }) {
    this._required = new Set(init.required);
    this._passed = new Set(init.passed);
    this._attempts = Math.max(0, init.attempts | 0);
    this._planHistoryHashes = [...init.planHistoryHashes];
    this._installNeeded = init.installNeeded;
    this._batchSplitCount = Math.max(0, (init.batchSplitCount ?? 0) | 0);

    // Invariant: passed ⊆ required. Silently intersect so a bad rehydrate
    // (e.g. required shrank across a schema change) degrades gracefully.
    for (const p of this._passed) {
      if (!this._required.has(p)) this._passed.delete(p);
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Construction
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Fresh session for a brand-new verification task. `build` is always
   * required; the other gates are conditional on the environment.
   */
  static createFresh(env: VerificationSessionEnv): VerificationSession {
    const required: Gate[] = ['build'];
    if (env.isTs) required.unshift('typecheck');
    if (env.hasTests) required.push('test');
    return new VerificationSession({
      required,
      passed: [],
      attempts: 0,
      planHistoryHashes: [],
    });
  }

  /**
   * Rehydrate from a snapshot produced by a previous worker invocation.
   * Unknown / legacy fields on `snap` are silently ignored — the snapshot
   * is the *projection*, not the contract (`attemptedThisCycle` is a
   * retired field left in older session files and is intentionally
   * dropped here).
   */
  static rehydrate(snap: VerificationSnapshot | undefined | null): VerificationSession {
    const safe = snap ?? EMPTY_SNAPSHOT;
    return new VerificationSession({
      required: safe.required ?? [],
      passed: safe.passed ?? [],
      attempts: safe.attempts ?? 0,
      planHistoryHashes: safe.planHistoryHashes ?? [],
      installNeeded: safe.installNeeded,
      batchSplitCount: safe.batchSplitCount,
    });
  }

  /**
   * Populate the required-gate set from the plan-entry environment on a
   * pre-existing session whose `required` is empty. Used when a scenario
   * seed carries only metadata (attempts, history) and leaves gate
   * configuration to the phase layer's environment probe. Idempotent — a
   * session whose required set is already non-empty is left untouched so
   * the call can be made unconditionally from `initSession`.
   */
  hydrateEnv(env: VerificationSessionEnv): void {
    if (this._required.size > 0) return;
    if (env.isTs) this._required.add('typecheck');
    this._required.add('build');
    if (env.hasTests) this._required.add('test');
  }

  // ──────────────────────────────────────────────────────────────────────
  // Queries
  // ──────────────────────────────────────────────────────────────────────

  isComplete(): boolean {
    for (const gate of this._required) {
      if (!this._passed.has(gate)) return false;
    }
    return true;
  }

  /** Required gates not yet passed, in canonical gate order. */
  missing(): Gate[] {
    return GATE_ORDER.filter(g => this._required.has(g) && !this._passed.has(g));
  }

  /** Required gates that have already passed, in canonical gate order. */
  passed(): Gate[] {
    return GATE_ORDER.filter(g => this._required.has(g) && this._passed.has(g));
  }

  /** All required gates, in canonical order. */
  required(): Gate[] {
    return GATE_ORDER.filter(g => this._required.has(g));
  }

  attempts(): number {
    return this._attempts;
  }

  /** True once `_attempts >= DEEP_DIAGNOSTIC_THRESHOLD`; activates config-snapshot injection. */
  inDeepMode(): boolean {
    return this._attempts >= DEEP_DIAGNOSTIC_THRESHOLD;
  }

  /**
   * Count how many consecutive trailing history entries share the
   * candidate plan's hash. `{ repeated: false, count: 0 }` means the plan
   * is new.
   *
   * Empty-plan handling: the empty string hashes to a stable SHA-1 value
   * (`normalizePlanForHash` falls into the catch branch and hashes the
   * collapsed empty body). Thus two consecutive empty-plan cycles — the
   * LLM's "silent give-up" pattern where the plan phase emits neither
   * `<plan>` nor a valid JSON body — register as a repeated hash and the
   * plan retry terminator can fire `no_progress` through the same
   * mechanism that catches literal repeated plans. No separate counter
   * is needed.
   */
  isPlanRepeated(planText: string): { repeated: boolean; count: number } {
    const hash = normalizePlanForHash(planText);
    const count = countRepeatedHash(this._planHistoryHashes, hash);
    return { repeated: count > 0, count };
  }

  batchSplitCount(): number {
    return this._batchSplitCount;
  }

  installNeeded(): boolean {
    return this._installNeeded === true;
  }

  /**
   * Tri-state dependency-install status for the plan prompt. Authoritative
   * source is `areDepsInstalled(featureRootPath)` called from the plan-entry
   * path (`nodes/plan/parts/entry.ts#recomputeInstallNeeded`); this Session
   * field is a per-entry observation cache so prompt/guard readers within a
   * single task do not walk the filesystem repeatedly.
   *
   *   - `'changed'`  — at least one declared dep is missing from node_modules.
   *   - `'current'`  — every declared dep resolves under node_modules.
   *   - `'unknown'`  — not a JS project (no package.json) OR the observation
   *                    has not run yet; the plan prompt omits the dep hint.
   */
  dependencyStatus(): 'current' | 'changed' | 'unknown' {
    if (this._installNeeded === true) return 'changed';
    if (this._installNeeded === false) return 'current';
    return 'unknown';
  }

  // ──────────────────────────────────────────────────────────────────────
  // Mutations (the only legal writers)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Transition bookkeeping for a plan-node re-entry. Only `reverify` bumps
   * the attempt counter; `fresh`/`resumed`/`toolLoop`/`retry` are
   * idempotent no-ops at the session level (the phase layer handles fresh
   * initialisation via `createFresh`).
   *
   * `retry` was a verification-task-only call site that disappeared with
   * the verification fix-책임 제거 리팩토링 (verification never enters
   * the retry path under always-fan-out). The case is kept as an explicit
   * no-op so the `PlanEntry` union remains non-exhaustive at the call
   * site without forcing every caller to handle every reason.
   */
  onPlanEntry(reason: PlanEntry): void {
    if (reason === 'reverify') {
      this._attempts += 1;
    }
  }

  /**
   * A verification-gate command executed. When the command maps to a known
   * required gate and exited 0 the gate flips to passed; failure clears
   * the passed bit. The command-policy guard reads `passed()` directly —
   * there is no separate "attempted" bookkeeping.
   */
  onCommand(gate: Gate | undefined, success: boolean): void {
    if (!gate || !this._required.has(gate)) return;
    if (success) this._passed.add(gate);
    else this._passed.delete(gate);
  }

  /**
   * Files changed; invalidate the affected gates' passed status. Scope
   * mirrors the historical `invalidationScope` helper — `all` clears every
   * passed gate, while targeted scopes clear just the implicated gate.
   *
   * Install-needed propagation was removed (F3 — observation-based SSOT).
   * The next plan entry calls `areDepsInstalled` directly on the codebase,
   * so a stale in-memory flag cannot mislead the install decision.
   */
  onFileChanged(scope: 'all' | 'build' | 'test' | 'typecheck'): void {
    if (scope === 'all') {
      this._passed.clear();
    } else if (this._required.has(scope)) {
      this._passed.delete(scope);
    }
  }

  /**
   * Record a plan that has been applied (past tense). The hash list is
   * always appended — even when `planText` is empty — so that consumers
   * (e.g. operator tooling, future safety nets) can detect repeated /
   * silent-give-up streaks via `isPlanRepeated`. An empty string has a
   * stable SHA-1 value, so two consecutive empty-plan cycles register
   * with `isPlanRepeated.count === 2`.
   */
  onPlanApplied(planText: string): void {
    this._planHistoryHashes.push(normalizePlanForHash(planText));
  }

  /**
   * Per-entry observation cache setter. Called from
   * `recomputeInstallNeeded` (plan/parts/entry.ts) after it observes
   * `areDepsInstalled`. Does NOT clear gates — gate invalidation happens
   * only in response to actual file writes surfaced by the tool hook.
   */
  markInstallNeeded(needed: boolean): void {
    this._installNeeded = needed;
  }

  /**
   * A batch-split cycle just fired. Bumps the cycle counter and the generic
   * attempt counter. A batch-split is "one more diagnostic failure that did
   * not resolve the task"; treating it as a non-event would leave
   * `inDeepMode()` stuck at false across an arbitrary chain of splits
   * (because `onPlanEntry('reverify')` is not on the batch-split → requeue →
   * fresh-entry path). Counting it here keeps the `attempts` axis monotonic
   * across ANY plan-cycle failure, which is what deep-diagnostic mode and
   * the verification cycle banner both depend on.
   *
   * Argument is accepted for backward compatibility but no longer stored —
   * the diagnostics summary used to be carried into the follow-up prompt
   * via `previousBatchDiagnostics`, but that channel was removed when
   * verification stopped owning fix responsibility (every fan-out now
   * yields fresh per-target sub-tasks; there is no follow-up prompt to
   * carry the prior diagnostic into).
   */
  onBatchSplit(_snapshotJson?: string): void {
    this._batchSplitCount += 1;
    this._attempts += 1;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Snapshot
  // ──────────────────────────────────────────────────────────────────────

  /** JSON-friendly projection suitable for `task.resumeState`. */
  snapshot(): VerificationSnapshot {
    return {
      required: this.required(),
      passed: this.passed(),
      attempts: this._attempts,
      planHistoryHashes: [...this._planHistoryHashes],
      installNeeded: this._installNeeded,
      batchSplitCount: this._batchSplitCount,
    };
  }
}
