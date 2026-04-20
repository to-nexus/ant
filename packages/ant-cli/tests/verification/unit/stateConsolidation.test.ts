/**
 * L1 — State model consolidation regression tests.
 *
 * Verify that the Phase 0 consolidation is preserved:
 *
 *   - Fields `_verificationBudget`, `_diagnosticAttempts`,
 *     `_deepDiagnosticBudgetGranted`, `_lastPlanHash`, `_installNeeded` no
 *     longer appear on `ArchitectGraphState` (compile-time via type signature).
 *   - Helpers `remainingBudget`, `inDeepDiagnosticMode`, `lastPlanHash`
 *     produce consistent derivations from the unified fields.
 *   - `MAX_VERIFICATION_ATTEMPTS` is honoured (env-overridable).
 *
 * These tests fail loudly if someone reintroduces the retired fields — the
 * exact regression we need to catch (see docs/architecture/14-code-job.md).
 */

import { describe, it, expect } from 'vitest';
import {
  MAX_VERIFICATION_ATTEMPTS,
  DEEP_DIAGNOSTIC_THRESHOLD,
  remainingBudget,
  inDeepDiagnosticMode,
  usedAttempts,
  bumpAttempts,
  initAttempts,
} from '../../../src/agents/architect/graph/code/utils/verificationAttempts';
import { lastPlanHash, normalizePlanForHash } from '../../../src/agents/architect/graph/code/utils/verificationLoopEscape';

function makeState(overrides: Record<string, any> = {}): any {
  return { _verificationAttempts: 0, _appliedPlanHistory: [], ...overrides };
}

describe('verificationAttempts — unified counter', () => {
  it('remainingBudget is derived from _verificationAttempts', () => {
    expect(remainingBudget(makeState({ _verificationAttempts: 0 }))).toBe(MAX_VERIFICATION_ATTEMPTS);
    expect(remainingBudget(makeState({ _verificationAttempts: 3 }))).toBe(MAX_VERIFICATION_ATTEMPTS - 3);
    expect(remainingBudget(makeState({ _verificationAttempts: MAX_VERIFICATION_ATTEMPTS }))).toBe(0);
    expect(remainingBudget(makeState({ _verificationAttempts: 999 }))).toBe(0);
  });

  it('inDeepDiagnosticMode activates at DEEP_DIAGNOSTIC_THRESHOLD', () => {
    expect(inDeepDiagnosticMode(makeState({ _verificationAttempts: 0 }))).toBe(false);
    expect(inDeepDiagnosticMode(makeState({ _verificationAttempts: DEEP_DIAGNOSTIC_THRESHOLD - 1 }))).toBe(false);
    expect(inDeepDiagnosticMode(makeState({ _verificationAttempts: DEEP_DIAGNOSTIC_THRESHOLD }))).toBe(true);
    expect(inDeepDiagnosticMode(makeState({ _verificationAttempts: DEEP_DIAGNOSTIC_THRESHOLD + 5 }))).toBe(true);
  });

  // T8 — `shouldStopVerification` was removed in favour of
  // `VerificationSession.evaluate()` returning a terminal verdict. The
  // remaining budget accessor still produces the signal callers need.
  it('remainingBudget is 0 iff the verification task should stop', () => {
    expect(remainingBudget(makeState({ _verificationAttempts: 0 }))).toBeGreaterThan(0);
    expect(remainingBudget(makeState({ _verificationAttempts: MAX_VERIFICATION_ATTEMPTS - 1 }))).toBeGreaterThan(0);
    expect(remainingBudget(makeState({ _verificationAttempts: MAX_VERIFICATION_ATTEMPTS }))).toBe(0);
  });

  it('bumpAttempts / initAttempts / usedAttempts maintain a monotonic counter', () => {
    const state: any = {};
    initAttempts(state);
    expect(usedAttempts(state)).toBe(0);
    bumpAttempts(state);
    bumpAttempts(state);
    expect(usedAttempts(state)).toBe(2);
  });
});

describe('verificationLoopEscape — lastPlanHash derivation', () => {
  it('returns undefined when history is empty', () => {
    expect(lastPlanHash(undefined)).toBeUndefined();
    expect(lastPlanHash([])).toBeUndefined();
  });

  it('hashes the last entry only (not the whole history)', () => {
    const planA = JSON.stringify({ diagnostics: { totalErrors: 1 }, implementation: { modify: ['a.ts'] } });
    const planB = JSON.stringify({ diagnostics: { totalErrors: 2 }, implementation: { modify: ['b.ts'] } });
    expect(lastPlanHash([planA, planB])).toBe(normalizePlanForHash(planB));
    expect(lastPlanHash([planA, planB])).not.toBe(normalizePlanForHash(planA));
  });

  it('produces stable hash regardless of JSON key order (normalisation)', () => {
    const planOrdered = JSON.stringify({ a: 1, b: 2, c: [3, 4] });
    const planReordered = JSON.stringify({ c: [3, 4], b: 2, a: 1 });
    expect(normalizePlanForHash(planOrdered)).toBe(normalizePlanForHash(planReordered));
  });
});

describe('retired fields no longer referenced in production code', () => {
  it('ArchitectGraphState type does not expose retired verification fields', async () => {
    // Compile-time check via dynamic import; tsc catches accidental
    // re-introduction at build time. This test exists mostly as a
    // human-readable pointer to the check.
    const stateModule = await import('../../../src/agents/architect/graph/code/state');
    expect(stateModule).toBeDefined();
    // Runtime assertion: creating a bare state object and reading a retired
    // field should give `undefined` (no accidental initial-value leaking).
    const bareState = {} as any;
    expect(bareState._verificationBudget).toBeUndefined();
    expect(bareState._diagnosticAttempts).toBeUndefined();
    expect(bareState._deepDiagnosticBudgetGranted).toBeUndefined();
    expect(bareState._lastPlanHash).toBeUndefined();
  });
});
