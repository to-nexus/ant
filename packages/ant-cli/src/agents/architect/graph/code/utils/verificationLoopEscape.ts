/**
 * Verification Loop Escape — unified short-circuit policies for verification/error tasks.
 *
 * Consolidates three formerly-independent axes that each addressed a different
 * flavour of "wasteful loop":
 *
 *   - F-1 `hasEmptyImplementation` — plan produced an empty implementation;
 *     execute has nothing to do, skip straight to checkTaskStatus.
 *   - F-3 `shouldSkipReverify`      — verification tracker is already complete
 *     (tracker.{typecheck,build,test}Passed == true); reverify would only add
 *     a no-op round-trip, skip.
 *   - F-4 `detectRepeatedPlan`      — LLM produced the same plan structure as
 *     a previous attempt; escalate rather than loop.
 *
 * The three are surfaced together because they share a single question:
 * "is there actual new work to do here, or should we break the loop?"
 *
 * All three used to live as scattered helpers inside `plan/index.ts` and
 * routers with cross-Axis commentary. This module collects them so callers
 * can answer the question with a single `decideLoopEscape(state, planText)`
 * call when appropriate, or use the individual predicates when they already
 * know which flavour applies.
 */

import * as crypto from 'node:crypto';

import type { ArchitectGraphState } from '../state';
import type { VerificationTracker } from '../state';
import { isVerificationComplete } from './verificationCompleteness';

// ────────────────────────────────────────────────────────────────────────────
// F-1 — Empty implementation detection
// ────────────────────────────────────────────────────────────────────────────

/**
 * Strip markdown code fences so `JSON.parse` can consume typical LLM output.
 */
function stripFences(text: string): string {
  const trimmed = text.trim();
  const m = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n\s*```$/);
  return m ? m[1].trim() : trimmed;
}

/**
 * Return true when the plan JSON has no actionable `modify` / `create` /
 * `delete` entries and no batches. Also true for genuinely empty plan text,
 * which previously slipped through to execute and burnt budget.
 *
 * The historical implementation in `planRouter.hasEmptyImplementation`
 * returned `false` for empty body, which kept the router on the execute
 * path and was the direct cause of the "empty plan → execute → tracker
 * still failing → re-queue" loop observed in the `still-lacing-north`
 * incident. Here we treat empty body as "empty implementation", which
 * short-circuits to checkTaskStatus and lets tracker validation drive the
 * next decision.
 */
export function hasEmptyImplementation(planText: string | undefined): boolean {
  if (!planText) return true;
  const body = stripFences(planText);
  if (!body.length) return true;
  try {
    const parsed = JSON.parse(body);
    const impl = parsed.implementation || {};
    const modifyCount = Array.isArray(impl.modify) ? impl.modify.length : 0;
    const createCount = Array.isArray(impl.create) ? impl.create.length : 0;
    const deleteCount = Array.isArray(impl.delete) ? impl.delete.length : 0;
    const hasBatches = Array.isArray(parsed.batches) && parsed.batches.length > 0;
    return !hasBatches && modifyCount === 0 && createCount === 0 && deleteCount === 0;
  } catch {
    // Unparseable plan text — be conservative and say NOT empty, so the
    // execute path can still try to salvage the LLM's intent.
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// F-3 — Skip reverify when tracker is already complete
// ────────────────────────────────────────────────────────────────────────────

/**
 * Return true when all required verification objectives have already passed;
 * a reverify pass would be wasted work. `executeRouter` uses this to skip the
 * `_nextPlanEntry='reverify'` assignment and route straight to
 * `checkTaskStatus`.
 */
export function shouldSkipReverify(tracker: VerificationTracker | undefined): boolean {
  return isVerificationComplete(tracker).ok;
}

// ────────────────────────────────────────────────────────────────────────────
// F-4 — Repeated plan detection (hash-based)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Produce a stable SHA-1 hash for a plan JSON body. Keys are sorted, arrays
 * preserved in order, whitespace collapsed on parse failure. Designed to
 * ignore trivial formatting drift so the "same plan again" detection does
 * not false-fire on cosmetic differences.
 */
export function normalizePlanForHash(planText: string): string {
  const body = planText.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```$/, '');
  try {
    const parsed = JSON.parse(body);
    const stable = JSON.stringify(parsed, (_k, v) => {
      if (Array.isArray(v)) return v;
      if (v && typeof v === 'object') {
        return Object.keys(v).sort().reduce((acc: Record<string, unknown>, k) => {
          acc[k] = (v as Record<string, unknown>)[k];
          return acc;
        }, {});
      }
      return v;
    });
    return crypto.createHash('sha1').update(stable).digest('hex');
  } catch {
    const collapsed = body.replace(/\s+/g, ' ').trim();
    return crypto.createHash('sha1').update(collapsed).digest('hex');
  }
}

/**
 * Derive the last-applied plan hash from the history. Previously stored in a
 * separate `_lastPlanHash` state field; now derived to avoid a second source
 * of truth that could drift from `_appliedPlanHistory`.
 */
export function lastPlanHash(history: string[] | undefined): string | undefined {
  if (!history || history.length === 0) return undefined;
  return normalizePlanForHash(history[history.length - 1]);
}

export interface RepeatedPlanDetection {
  repeated: boolean;
  /** How many times this exact hash has appeared in history (including current). */
  count: number;
}

/**
 * True iff the hash of `candidatePlan` equals the hash of the most recent
 * entry in `history`. Returns a `count` of identical consecutive hashes at
 * the tail so callers can decide escalation severity.
 */
export function detectRepeatedPlan(
  history: string[] | undefined,
  candidatePlan: string,
): RepeatedPlanDetection {
  if (!history || history.length === 0) return { repeated: false, count: 0 };
  const candidateHash = normalizePlanForHash(candidatePlan);
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (normalizePlanForHash(history[i]) === candidateHash) count++;
    else break;
  }
  return { repeated: count > 0, count };
}

// ────────────────────────────────────────────────────────────────────────────
// Unified decision entry-point
// ────────────────────────────────────────────────────────────────────────────

export type LoopEscape =
  /** Plan had nothing actionable; skip execute and let checkTaskStatus decide. */
  | { kind: 'empty_plan'; action: 'short_circuit' }
  /** Verification tracker already complete; skip reverify. */
  | { kind: 'already_complete'; action: 'short_circuit' }
  /** Same plan hash as previous attempt(s); caller should escalate. */
  | { kind: 'repeated_plan'; count: number; action: 'force_split' | 'escalate' };

/**
 * Inspect the current verification state and return a single, typed verdict
 * about whether the caller should break out of the loop, or proceed with
 * execute as normal (returns `null`).
 *
 * Caller uses the `action` field to pick a concrete response:
 *   - `'short_circuit'` → set `llmResponse.done=true`, route to checkTaskStatus
 *   - `'force_split'`   → call `processDiagnosticBatchSplit` with a forced split
 *   - `'escalate'`      → raise `VerificationTerminalError(kind='no_progress')`
 *
 * Note: callers that only care about one flavour (e.g. `planRouter` only needs
 * `hasEmptyImplementation`) may keep using the individual predicates above.
 */
export function decideLoopEscape(
  state: ArchitectGraphState,
  planText: string | undefined,
): LoopEscape | null {
  if (hasEmptyImplementation(planText)) {
    return { kind: 'empty_plan', action: 'short_circuit' };
  }

  if (planText && state._appliedPlanHistory && state._appliedPlanHistory.length > 0) {
    const detection = detectRepeatedPlan(state._appliedPlanHistory, planText);
    if (detection.repeated) {
      // Two+ identical plans in a row means the LLM is stuck — escalate hard.
      // One repeat can still be recovered via force-split.
      const action: 'force_split' | 'escalate' = detection.count >= 2 ? 'escalate' : 'force_split';
      return { kind: 'repeated_plan', count: detection.count, action };
    }
  }

  if (shouldSkipReverify(state._verificationTracker)) {
    return { kind: 'already_complete', action: 'short_circuit' };
  }

  return null;
}
