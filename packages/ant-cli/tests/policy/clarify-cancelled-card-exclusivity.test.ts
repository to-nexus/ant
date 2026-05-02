/**
 * Clarify ↔ cancelled-card SSOT — three orthogonal concerns lock together
 * because they share the same JobCleanupManager call site.
 *
 *   1. Invariant I2 — exclusivity gate
 *      `shouldSuppressCancelledCardForClarify` MUST suppress the
 *      cancelled (Resume / Dismiss) card whenever a non-task job (plan
 *      / visual) is paused with `awaitingClarify === true`. Decomposable
 *      jobs (code / design / learn) and other pause reasons (recursion
 *      / user_stopped / fatal) keep the cancelled flow.
 *
 *   2. consumeAwaitingClarify — continuation helper
 *      Shared between design docGen and planner generate. Must append
 *      `overrideDirective` to the target NODE conversation key as a
 *      user message, no-op on falsy / empty inputs, idempotent on
 *      repeat invocations, preserve other conversation keys.
 *
 *   3. Phase A / Phase B isolation in JobCleanupManager
 *      The cancelled-card emit MUST run outside the session/broadcast
 *      try/catch so a Phase A throw cannot suppress the Resume/Dismiss
 *      UI (RCA: cancelled-card-missing).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { shouldSuppressCancelledCardForClarify } from '../../src/periphery/adapters/http/express/managers/JobCleanupManager';
import {
  consumeAwaitingClarify,
  type ClarifyContinuableState,
} from '../../src/agents/common/clarify';
import { CONV_KEYS } from '../../src/agents/common/graph/conversations';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const JOB_CLEANUP_SRC = resolve(
  __dirname,
  '../../src/periphery/adapters/http/express/managers/JobCleanupManager.ts',
);

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

// ────────────────────────────────────────────────────────────────────────────
// consumeAwaitingClarify — shared continuation helper
// (design docGen NODE_DOCGEN + planner generate NODE_GENERATE)
// ────────────────────────────────────────────────────────────────────────────

describe('consumeAwaitingClarify', () => {
  function makeState(overrides: Partial<ClarifyContinuableState> = {}): ClarifyContinuableState {
    return {
      conversations: {},
      ...overrides,
    };
  }

  it('appends overrideDirective to the target NODE key as a user message', () => {
    const state = makeState({
      awaitingClarify: true,
      overrideDirective: 'a) puzzle mode\nb) web browser',
      conversations: {
        [CONV_KEYS.NODE_GENERATE]: [
          { role: 'user', content: 'Build a match-3 game' },
          { role: 'assistant', content: 'Asking clarifying questions…' },
        ],
      },
    });

    consumeAwaitingClarify(state, CONV_KEYS.NODE_GENERATE);

    const history = state.conversations[CONV_KEYS.NODE_GENERATE];
    expect(history).toHaveLength(3);
    expect(history?.[2]).toEqual({
      role: 'user',
      content: 'a) puzzle mode\nb) web browser',
    });
    expect(state.awaitingClarify).toBe(false);
  });

  it('uses NODE_DOCGEN by default for design docGen call sites', () => {
    const state = makeState({
      awaitingClarify: true,
      overrideDirective: 'spec answer',
      conversations: {
        [CONV_KEYS.NODE_DOCGEN]: [
          { role: 'user', content: 'spec request' },
          { role: 'assistant', content: 'clarify text' },
        ],
      },
    });

    consumeAwaitingClarify(state);

    expect(state.conversations[CONV_KEYS.NODE_DOCGEN]).toHaveLength(3);
    expect(state.conversations[CONV_KEYS.NODE_DOCGEN]?.[2]).toEqual({
      role: 'user',
      content: 'spec answer',
    });
  });

  it('is a no-op when awaitingClarify is falsy (new job)', () => {
    const state = makeState({
      awaitingClarify: false,
      overrideDirective: 'fresh directive',
      conversations: {
        [CONV_KEYS.NODE_GENERATE]: [{ role: 'user', content: 'previous' }],
      },
    });

    const before = JSON.stringify(state.conversations);
    consumeAwaitingClarify(state, CONV_KEYS.NODE_GENERATE);
    expect(JSON.stringify(state.conversations)).toBe(before);
    expect(state.awaitingClarify).toBe(false);
  });

  it('is a no-op when overrideDirective is empty (avoid blank user turn)', () => {
    const state = makeState({
      awaitingClarify: true,
      overrideDirective: '',
      conversations: {
        [CONV_KEYS.NODE_GENERATE]: [{ role: 'assistant', content: 'clarify text' }],
      },
    });

    consumeAwaitingClarify(state, CONV_KEYS.NODE_GENERATE);

    expect(state.conversations[CONV_KEYS.NODE_GENERATE]).toHaveLength(1);
    expect(state.awaitingClarify).toBe(true);
  });

  it('is idempotent — second call after consume does nothing', () => {
    const state = makeState({
      awaitingClarify: true,
      overrideDirective: 'answer',
      conversations: {
        [CONV_KEYS.NODE_GENERATE]: [{ role: 'assistant', content: 'q' }],
      },
    });

    consumeAwaitingClarify(state, CONV_KEYS.NODE_GENERATE);
    const afterFirst = JSON.stringify(state.conversations);
    consumeAwaitingClarify(state, CONV_KEYS.NODE_GENERATE);
    expect(JSON.stringify(state.conversations)).toBe(afterFirst);
  });

  it('preserves other conversation keys (shallow merge semantics)', () => {
    const state = makeState({
      awaitingClarify: true,
      overrideDirective: 'answer',
      conversations: {
        [CONV_KEYS.SESSION_MAIN]: [{ role: 'user', content: 'session-main' }],
        [CONV_KEYS.NODE_GENERATE]: [{ role: 'assistant', content: 'q' }],
      },
    });

    consumeAwaitingClarify(state, CONV_KEYS.NODE_GENERATE);

    expect(state.conversations[CONV_KEYS.SESSION_MAIN]).toEqual([
      { role: 'user', content: 'session-main' },
    ]);
    expect(state.conversations[CONV_KEYS.NODE_GENERATE]).toHaveLength(2);
  });

  it('initializes the target conversation key when missing', () => {
    const state = makeState({
      awaitingClarify: true,
      overrideDirective: 'answer',
      conversations: {},
    });

    consumeAwaitingClarify(state, CONV_KEYS.NODE_GENERATE);

    expect(state.conversations[CONV_KEYS.NODE_GENERATE]).toEqual([
      { role: 'user', content: 'answer' },
    ]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// JobCleanupManager — Phase A / Phase B isolation (RCA: cancelled-card-missing)
// Source-text guards: alternative is heavy mock of session/kanban/chat
// services, which would mostly exercise the mocks not the structural invariant.
// ────────────────────────────────────────────────────────────────────────────

describe('JobCleanupManager — cancelled-card emit isolation (RCA guard)', () => {
  const source = readFileSync(JOB_CLEANUP_SRC, 'utf8');

  it('Phase A catch label discriminates the session/broadcast phase from the cancelled-card phase', () => {
    expect(source).toMatch(/Error in cleanupJobState session\/broadcast phase/);
    expect(source).not.toMatch(/['"`]Error in cleanupJobState['"`]/);
  });

  it('cancelled-card emission lives outside the Phase A try/catch', () => {
    const phaseACatchIdx = source.indexOf('Error in cleanupJobState session/broadcast phase');
    const emitIdx = source.indexOf('await this.deps.chatService.appendChoicePresentedCancelled(');
    expect(phaseACatchIdx).toBeGreaterThan(0);
    expect(emitIdx).toBeGreaterThan(0);
    expect(emitIdx).toBeGreaterThan(phaseACatchIdx);
  });

  it('cancelled-card emit is wrapped in its own try/catch so a Redis blip surfaces with a clear log', () => {
    expect(source).toMatch(
      /appendChoicePresentedCancelled threw — Resume\/Dismiss UI will be missing for this pause/,
    );
  });

  it('cancelled-card emit logs the result so operators can distinguish emit / NX-miss / no-user_turn paths', () => {
    expect(source).toMatch(/appendChoicePresentedCancelled result/);
    expect(source).toMatch(/emitted: result\.emitted/);
    expect(source).toMatch(/cardId: result\.cardId/);
  });

  it('Phase B suppression gate (Invariant I2 — clarify) survives null sessionData', () => {
    expect(source).toMatch(
      /shouldSuppressCancelledCardForClarify\(\s*jobType,\s*sessionData\?\.state,?\s*\)/,
    );
  });
});
