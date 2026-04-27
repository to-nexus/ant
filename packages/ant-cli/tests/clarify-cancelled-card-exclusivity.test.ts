/**
 * clarify-cancelled-card-exclusivity — Invariant I2
 *
 * The clarify card and the cancelled (Resume / Dismiss) card must not
 * coexist for the same paused job. Both ARE paused-state UI; emitting
 * them simultaneously produces conflicting affordances ("Submit answer"
 * vs "Resume") and breaks chat-SSOT card-identity. The gate is narrow:
 * suppression fires only when the job is non-task (plan / visual) AND
 * its session has `awaitingClarify === true`.
 *
 * Decomposable jobs (code / design / learn) and non-task jobs paused for
 * OTHER reasons (recursion limit / user_stopped / fatal error) keep the
 * existing cancelled-card flow — that non-invasive boundary is part of
 * the contract and is locked here.
 */

import { describe, it, expect } from 'vitest';
import { shouldSuppressCancelledCardForClarify } from '../src/periphery/adapters/http/express/managers/JobCleanupManager';

describe('Invariant I2 — clarify ↔ cancelled card exclusivity', () => {
  it('suppresses cancelled card for plan job with awaitingClarify=true', () => {
    expect(
      shouldSuppressCancelledCardForClarify('plan', { awaitingClarify: true }),
    ).toBe(true);
  });

  it('suppresses cancelled card for visual job with awaitingClarify=true', () => {
    expect(
      shouldSuppressCancelledCardForClarify('visual', { awaitingClarify: true }),
    ).toBe(true);
  });

  it('does NOT suppress for plan job paused for other reasons (no awaitingClarify)', () => {
    expect(
      shouldSuppressCancelledCardForClarify('plan', { awaitingClarify: false }),
    ).toBe(false);
    expect(
      shouldSuppressCancelledCardForClarify('plan', {}),
    ).toBe(false);
    expect(
      shouldSuppressCancelledCardForClarify('plan', undefined),
    ).toBe(false);
  });

  it('does NOT suppress for decomposable jobs even if awaitingClarify is true', () => {
    // The flag has no semantics for code / design / learn — the gate
    // must still let cancelled cards through to keep their existing
    // user_stopped / recursion_limit flow non-invasive.
    expect(
      shouldSuppressCancelledCardForClarify('code', { awaitingClarify: true }),
    ).toBe(false);
    expect(
      shouldSuppressCancelledCardForClarify('design', { awaitingClarify: true }),
    ).toBe(false);
    expect(
      shouldSuppressCancelledCardForClarify('learn', { awaitingClarify: true }),
    ).toBe(false);
  });

  it('does NOT suppress for unknown / undefined jobType', () => {
    expect(
      shouldSuppressCancelledCardForClarify('ask', { awaitingClarify: true }),
    ).toBe(false);
    expect(
      shouldSuppressCancelledCardForClarify('inline-ask', { awaitingClarify: true }),
    ).toBe(false);
  });
});
