/**
 * VerificationSession — the single authority for "where is this verification
 * task in its diagnostic cycle?".
 *
 * Replaces five state fields (`_verificationTracker`, `_verificationAttempts`,
 * `_appliedPlanHistory`, `_depFileHash`, `_installNeeded`) and the seven
 * scattered mutator sites that touched them. Every query and mutation goes
 * through this class so invariants ("passed ⊆ required",
 * "attempts ≥ 0", "repeated-plan derived from history") cannot drift.
 *
 * R2 — model-only. Does not import from `nodes/`, `routers/`, or `parallel/`.
 * Hooks (added in T5) sit above this module and translate phase events
 * (`onPlanEntry`, `onCommand`, …) into Session mutations.
 *
 * Environment:
 *   - `ANT_MAX_VERIFICATION_ATTEMPTS` — ceiling for the attempt counter
 *     (default 6). Back-compat: honours the legacy `ANT_VERIFICATION_BUDGET`
 *     name when the new var is absent.
 *   - `ANT_DEEP_DIAGNOSTIC_THRESHOLD` — attempts at which deep-diagnostic
 *     mode activates (default 2).
 *   - `ANT_VERIFICATION_SPLIT_ERRORS` / `ANT_VERIFICATION_SPLIT_FILES` —
 *     force-split thresholds consulted by `evaluate(...)`.
 */

import type { Gate } from './gates';
import { GATE_ORDER } from './gates';
import type { VerificationSnapshot } from './snapshot';
import { EMPTY_SNAPSHOT } from './snapshot';
import type { VerificationOutcome } from './outcome';
import { countRepeatedHash, normalizePlanForHash } from './planHash';

// ────────────────────────────────────────────────────────────────────────────
// Environment-driven constants
// ────────────────────────────────────────────────────────────────────────────

function envInt(name: string, fallback: number, legacyName?: string): number {
  const current = process.env[name];
  const legacy = legacyName ? process.env[legacyName] : undefined;
  const raw = current ?? legacy;
  if (raw == null) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const MAX_VERIFICATION_ATTEMPTS = envInt(
  'ANT_MAX_VERIFICATION_ATTEMPTS',
  6,
  'ANT_VERIFICATION_BUDGET',
);

export const DEEP_DIAGNOSTIC_THRESHOLD = envInt('ANT_DEEP_DIAGNOSTIC_THRESHOLD', 2);

const PLAN_HISTORY_BODY_LIMIT = 3;
const MAX_BATCH_SPLIT_CYCLES = 10;

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
import type { PlanEntry } from '../../_shared/types';
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

export interface EvaluateArgs {
  planText?: string;
  totalErrors?: number;
  modifyCount?: number;
  batches?: number;
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
  private readonly _attemptedThisCycle: Set<Gate>;
  private readonly _planHistoryHashes: string[];
  private readonly _planHistoryBodies: string[];

  private _attempts: number;
  private _depHash: string | undefined;
  private _installNeeded: boolean | undefined;
  private _batchSplitCount: number;
  private _previousBatchDiagnostics: string | undefined;

  private constructor(init: {
    required: Iterable<Gate>;
    passed: Iterable<Gate>;
    attemptedThisCycle: Iterable<Gate>;
    attempts: number;
    planHistoryHashes: string[];
    planHistoryBodies: string[];
    depHash?: string;
    installNeeded?: boolean;
    batchSplitCount?: number;
    previousBatchDiagnostics?: string;
  }) {
    this._required = new Set(init.required);
    this._passed = new Set(init.passed);
    this._attemptedThisCycle = new Set(init.attemptedThisCycle);
    this._attempts = Math.max(0, init.attempts | 0);
    this._planHistoryHashes = [...init.planHistoryHashes];
    this._planHistoryBodies = [...init.planHistoryBodies];
    this._depHash = init.depHash;
    this._installNeeded = init.installNeeded;
    this._batchSplitCount = Math.max(0, (init.batchSplitCount ?? 0) | 0);
    this._previousBatchDiagnostics = init.previousBatchDiagnostics;

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
      attemptedThisCycle: [],
      attempts: 0,
      planHistoryHashes: [],
      planHistoryBodies: [],
    });
  }

  /** Rehydrate from a snapshot produced by a previous worker invocation. */
  static rehydrate(snap: VerificationSnapshot | undefined | null): VerificationSession {
    const safe = snap ?? EMPTY_SNAPSHOT;
    return new VerificationSession({
      required: safe.required ?? [],
      passed: safe.passed ?? [],
      attemptedThisCycle: safe.attemptedThisCycle ?? [],
      attempts: safe.attempts ?? 0,
      planHistoryHashes: safe.planHistoryHashes ?? [],
      planHistoryBodies: safe.planHistoryBodies ?? [],
      depHash: safe.depHash,
      installNeeded: safe.installNeeded,
      batchSplitCount: safe.batchSplitCount,
      previousBatchDiagnostics: safe.previousBatchDiagnostics,
    });
  }

  /**
   * Synthesise a session from the T4a-era legacy state shape
   * (`_verificationTracker` / `_verificationAttempts` / `_appliedPlanHistory` /
   * `_depFileHash` / `_installNeeded`). Used exclusively by the
   * `ANT_SCENARIO_PRESERVE_RETRIES=1` harness in `runner.ts` so fixture
   * seeds authored before T4b-β can still populate `state.verification`
   * without the phase layer touching the legacy fields. Production resume
   * goes through `rehydrate` against the persisted snapshot.
   *
   * The `required` set is reconstructed from whatever the tracker declared
   * via its `*Required` flags (plus an always-required `build` gate to
   * match `createFresh`'s invariant); `passed` is read off the tracker's
   * `*Passed` flags, and `planHistoryHashes` is synthesised from the body
   * list so repeated-plan detection remains identical.
   */
  static fromLegacyState(legacy: {
    _verificationTracker?: {
      buildPassed?: boolean;
      testPassed?: boolean;
      testsRequired?: boolean;
      typecheckPassed?: boolean;
      typecheckRequired?: boolean;
      buildAttempted?: boolean;
      testAttempted?: boolean;
      typecheckAttempted?: boolean;
    };
    _verificationAttempts?: number;
    _appliedPlanHistory?: string[];
    _depFileHash?: string;
    _installNeeded?: boolean;
  }): VerificationSession {
    const tracker = legacy._verificationTracker;
    const required: Gate[] = ['build'];
    if (tracker?.typecheckRequired) required.unshift('typecheck');
    if (tracker?.testsRequired) required.push('test');

    const passed: Gate[] = [];
    if (tracker?.typecheckPassed && tracker.typecheckRequired) passed.push('typecheck');
    if (tracker?.buildPassed) passed.push('build');
    if (tracker?.testPassed && tracker.testsRequired) passed.push('test');

    const attemptedThisCycle: Gate[] = [];
    if (tracker?.typecheckAttempted && tracker.typecheckRequired) attemptedThisCycle.push('typecheck');
    if (tracker?.buildAttempted) attemptedThisCycle.push('build');
    if (tracker?.testAttempted && tracker.testsRequired) attemptedThisCycle.push('test');

    const planHistoryBodies = legacy._appliedPlanHistory ?? [];
    const planHistoryHashes = planHistoryBodies.map(normalizePlanForHash);

    return new VerificationSession({
      required,
      passed,
      attemptedThisCycle,
      attempts: legacy._verificationAttempts ?? 0,
      planHistoryHashes,
      planHistoryBodies,
      depHash: legacy._depFileHash,
      installNeeded: legacy._installNeeded,
    });
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

  remainingBudget(): number {
    return Math.max(0, MAX_VERIFICATION_ATTEMPTS - this._attempts);
  }

  /**
   * True once the task has re-entered the plan node at least
   * `DEEP_DIAGNOSTIC_THRESHOLD` times without converging. Downstream hooks
   * use this to loosen command guards and inject config snapshots.
   */
  inDeepMode(): boolean {
    return this._attempts >= DEEP_DIAGNOSTIC_THRESHOLD;
  }

  /**
   * Count how many consecutive trailing history entries share the
   * candidate plan's hash. `{ repeated: false, count: 0 }` means the plan
   * is new.
   */
  isPlanRepeated(planText: string): { repeated: boolean; count: number } {
    if (!planText) return { repeated: false, count: 0 };
    const hash = normalizePlanForHash(planText);
    const count = countRepeatedHash(this._planHistoryHashes, hash);
    return { repeated: count > 0, count };
  }

  batchSplitCount(): number {
    return this._batchSplitCount;
  }

  depHash(): string | undefined {
    return this._depHash;
  }

  installNeeded(): boolean {
    return this._installNeeded === true;
  }

  /**
   * Tri-state counterpart to the legacy `state._installNeeded` field:
   *
   *   - `'changed'`  — dependency manifest has drifted since the last
   *                    successful install (run the install command first).
   *   - `'current'`  — manifest is known to match the last install (safe
   *                    to skip install and go straight to build).
   *   - `'unknown'`  — session has not observed an install boundary yet;
   *                    the plan prompt should omit the dependency hint.
   *
   * Exposed so `hooks/plan.ts buildPrompt` can preserve the tri-state
   * prompt contract without reaching back into legacy state fields.
   */
  dependencyStatus(): 'current' | 'changed' | 'unknown' {
    if (this._installNeeded === true) return 'changed';
    if (this._installNeeded === false) return 'current';
    return 'unknown';
  }

  /** Recent plan bodies, newest last, bounded to `PLAN_HISTORY_BODY_LIMIT`. */
  planHistoryBodies(): readonly string[] {
    return this._planHistoryBodies;
  }

  previousBatchDiagnostics(): string | undefined {
    return this._previousBatchDiagnostics;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Evaluation (decision-only, no plan parsing)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Inspect the current session state plus any caller-supplied parsed
   * plan metadata and produce a typed verdict. Pure wrt the session (no
   * mutation) — the caller is responsible for any subsequent transitions
   * (e.g. throwing `VerificationTerminalError`, calling `onBatchSplit`).
   */
  evaluate(args: EvaluateArgs = {}): VerificationOutcome {
    const { planText, totalErrors, modifyCount, batches } = args;

    // 1. Already complete — skip the rest of the cycle.
    if (this.isComplete()) {
      return { kind: 'short_circuit', reason: 'already_complete' };
    }

    // 2. Batch cycle limit — hard stop on runaway cascade.
    if (this._batchSplitCount >= MAX_BATCH_SPLIT_CYCLES) {
      return {
        kind: 'terminal',
        errorKind: 'batch_cycle_limit',
        message: `Batch split cycle limit (${MAX_BATCH_SPLIT_CYCLES}) exceeded.`,
      };
    }

    // 3. Repeated plan escalation (needs planText).
    if (planText) {
      const repeat = this.isPlanRepeated(planText);
      if (repeat.count >= 2) {
        return {
          kind: 'terminal',
          errorKind: 'no_progress',
          message: `Same plan hash observed ${repeat.count} consecutive attempts.`,
        };
      }
      if (repeat.count === 1 && (modifyCount ?? 0) > 0) {
        return { kind: 'force_split', reason: 'repeated_plan' };
      }
    }

    // 4. Budget exhausted with work still pending.
    if (this.remainingBudget() <= 0) {
      if ((modifyCount ?? 0) >= 2 && (batches ?? 0) <= 1) {
        return { kind: 'force_split', reason: 'budget_low' };
      }
      return {
        kind: 'terminal',
        errorKind: 'budget_exhausted',
        message: `Verification attempts exhausted (${this._attempts}/${MAX_VERIFICATION_ATTEMPTS}).`,
      };
    }

    // 5. Diagnostic volume thresholds — force split when consolidated plan
    //    exceeds escalation thresholds.
    const thresholdErrors = envInt('ANT_VERIFICATION_SPLIT_ERRORS', 6);
    const thresholdFiles = envInt('ANT_VERIFICATION_SPLIT_FILES', 4);
    const hasBatches = (batches ?? 0) > 1;
    if (!hasBatches && (modifyCount ?? 0) >= 2) {
      if ((totalErrors ?? 0) >= thresholdErrors) {
        return { kind: 'force_split', reason: 'too_many_errors' };
      }
      if ((modifyCount ?? 0) >= thresholdFiles) {
        return { kind: 'force_split', reason: 'too_many_files' };
      }
    }

    // 6. Empty plan with no further work is a short-circuit, not a
    //    continue: there is nothing for execute to do and the cycle should
    //    route directly to checkTaskStatus.
    if (planText !== undefined && isEmptyPlanBody(planText)) {
      return { kind: 'short_circuit', reason: 'empty_plan' };
    }

    return { kind: 'continue' };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Mutations (the only legal writers)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Transition bookkeeping for a plan-node re-entry. `retry` and `reverify`
   * bump the attempt counter and clear the cycle's attempted set so the
   * plan tool loop can try each gate afresh. `fresh`/`resumed`/`toolLoop`
   * are idempotent no-ops at the session level (the phase layer handles
   * fresh initialisation via `createFresh`).
   */
  onPlanEntry(reason: PlanEntry): void {
    if (reason === 'retry' || reason === 'reverify') {
      this._attempts += 1;
      this._attemptedThisCycle.clear();
    }
  }

  /**
   * A verification-gate command executed. When the command maps to a known
   * gate and exited 0, that gate flips to passed; otherwise we only
   * remember that the gate was attempted in this cycle so repeat calls are
   * guarded against loops.
   */
  onCommand(gate: Gate | undefined, success: boolean): void {
    if (!gate || !this._required.has(gate)) return;
    this._attemptedThisCycle.add(gate);
    if (success) this._passed.add(gate);
    else this._passed.delete(gate);
  }

  /**
   * Files changed; invalidate the affected gates' passed status. Scope
   * mirrors the historical `invalidationScope` helper — `all` clears every
   * passed gate, while targeted scopes clear just the implicated gate.
   * `installNeeded` may be toggled simultaneously if the change touched
   * dependency manifests.
   */
  onFileChanged(
    scope: 'all' | 'build' | 'test' | 'typecheck',
    installNeeded?: boolean,
  ): void {
    if (scope === 'all') {
      this._passed.clear();
    } else if (this._required.has(scope)) {
      this._passed.delete(scope);
    }
    if (installNeeded !== undefined) this._installNeeded = installNeeded;
  }

  /**
   * Record a plan that has been applied (past tense). Pushes the body to
   * the bounded body buffer and the hash to the unbounded hash list. The
   * hash list stays compact because it stores 40-char strings only.
   */
  onPlanApplied(planText: string): void {
    if (!planText) return;
    this._planHistoryHashes.push(normalizePlanForHash(planText));
    this._planHistoryBodies.push(planText);
    while (this._planHistoryBodies.length > PLAN_HISTORY_BODY_LIMIT) {
      this._planHistoryBodies.shift();
    }
  }

  /**
   * Dependency install succeeded; persist the new hash so subsequent
   * entries can skip install when the manifest is unchanged.
   */
  onInstallResolved(depHash: string | undefined): void {
    this._depHash = depHash;
    this._installNeeded = false;
  }

  /**
   * Narrow setter for the install-needed flag used by
   * `recomputeInstallNeeded` (plan entry.ts). Distinct from `onFileChanged`
   * because the plan-entry dep-hash probe must NOT clear already-passed
   * gates — gate invalidation happens only in response to actual file
   * writes surfaced by the tool hook. Mirrors the legacy behaviour of
   * `state._installNeeded = needed` without touching the passed set.
   */
  markInstallNeeded(needed: boolean): void {
    this._installNeeded = needed;
  }

  /**
   * A batch-split cycle just fired. Bumps the cycle counter and stores the
   * diagnostics summary for injection into the follow-up prompt.
   */
  onBatchSplit(snapshotJson: string): void {
    this._batchSplitCount += 1;
    this._previousBatchDiagnostics = snapshotJson;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Snapshot
  // ──────────────────────────────────────────────────────────────────────

  /** JSON-friendly projection suitable for `task.resumeState`. */
  snapshot(): VerificationSnapshot {
    return {
      required: this.required(),
      passed: this.passed(),
      attemptedThisCycle: GATE_ORDER.filter(g => this._attemptedThisCycle.has(g)),
      attempts: this._attempts,
      planHistoryHashes: [...this._planHistoryHashes],
      planHistoryBodies: [...this._planHistoryBodies],
      depHash: this._depHash,
      installNeeded: this._installNeeded,
      batchSplitCount: this._batchSplitCount,
      previousBatchDiagnostics: this._previousBatchDiagnostics,
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Return true when the plan JSON has no actionable
 * `modify`/`create`/`delete` entries and no batches. Whitespace-only or
 * fenced-empty bodies also qualify.
 */
function isEmptyPlanBody(planText: string): boolean {
  if (!planText) return true;
  const body = planText
    .trim()
    .replace(/^```(?:json)?\s*\n?/, '')
    .replace(/\n?```$/, '')
    .trim();
  if (!body.length) return true;
  try {
    const parsed = JSON.parse(body);
    const impl = parsed.implementation ?? {};
    const modifyCount = Array.isArray(impl.modify) ? impl.modify.length : 0;
    const createCount = Array.isArray(impl.create) ? impl.create.length : 0;
    const deleteCount = Array.isArray(impl.delete) ? impl.delete.length : 0;
    const hasBatches = Array.isArray(parsed.batches) && parsed.batches.length > 0;
    return !hasBatches && modifyCount === 0 && createCount === 0 && deleteCount === 0;
  } catch {
    // Unparseable but non-empty text — treat as "has content" so the
    // execute path can try to salvage the LLM's intent.
    return false;
  }
}
