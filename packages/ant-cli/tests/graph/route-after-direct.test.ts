/**
 * Regression tests for `routeAfterDirect` + `_promotedThisJob` interaction.
 *
 * See §9 (`route_after_decompose_3way`) and §10 (`runtime_escalate`) in
 * docs/tmp/session-redesign-handoff.md. The router must honour the 1-shot
 * escalation cap: the FIRST needsEscalation signal routes to `decompose`,
 * and only a SECOND signal after re-entry routes to `learn`.
 */

import { describe, it, expect } from 'vitest';
import { routeAfterDirect } from '../../src/agents/architect/graph/code/routing';
import type { ArchitectGraphState } from '../../src/agents/architect/graph/code/state';

function makeState(partial: Partial<ArchitectGraphState>): ArchitectGraphState {
  return partial as unknown as ArchitectGraphState;
}

/**
 * Tiny simulator for the `_promotedThisJob` state transition that the direct
 * node performs at entry. Mirrors the actual logic in nodes/direct/index.ts
 * (keep in sync). We don't exercise the LLM loop here — just the flag
 * semantics that feed the router on return.
 */
function simulateDirectReturn(input: {
  entry: Partial<ArchitectGraphState>;
  loopEscalates: boolean;
}): { needsEscalation: boolean; _promotedThisJob: boolean } {
  const { entry, loopEscalates } = input;
  const wasEscalationReentry =
    entry.needsEscalation === true && entry._promotedThisJob !== true;
  const effectivePromoted =
    entry._promotedThisJob === true || wasEscalationReentry;
  // Loop guard blocks further escalation after re-entry
  const escalatedThisRun = loopEscalates && !effectivePromoted;
  // LLM-signal escalation bypasses the local guard (matches runtime)
  const needsEscalation = escalatedThisRun || (loopEscalates && effectivePromoted);
  return {
    needsEscalation,
    _promotedThisJob: effectivePromoted,
  };
}

describe('routeAfterDirect', () => {
  it('routes to learn when loop completes without escalation', () => {
    const state = makeState({ needsEscalation: undefined, _promotedThisJob: false });
    expect(routeAfterDirect(state)).toBe('learn');
  });

  it('routes first escalation to decompose (before any promotion)', () => {
    const state = makeState({ needsEscalation: true, _promotedThisJob: false });
    expect(routeAfterDirect(state)).toBe('decompose');
  });

  it('routes second escalation (after re-entry) to learn', () => {
    const state = makeState({ needsEscalation: true, _promotedThisJob: true });
    expect(routeAfterDirect(state)).toBe('learn');
  });
});

describe('direct ↔ routeAfterDirect lifecycle', () => {
  it('1st direct: fresh state + escalation → decompose', () => {
    // Entry: never promoted, no prior escalation
    const ret = simulateDirectReturn({
      entry: { _promotedThisJob: false },
      loopEscalates: true,
    });
    // CRITICAL: flag must still be false on first escalation so the router
    // can reach decompose.
    expect(ret._promotedThisJob).toBe(false);
    expect(ret.needsEscalation).toBe(true);
    expect(routeAfterDirect(makeState(ret as any))).toBe('decompose');
  });

  it('2nd direct: re-entered with prior escalation + no new signal → learn', () => {
    // Entry: decompose routed back, needsEscalation=true is leftover
    const ret = simulateDirectReturn({
      entry: { needsEscalation: true, _promotedThisJob: false },
      loopEscalates: false,
    });
    expect(ret._promotedThisJob).toBe(true);
    expect(ret.needsEscalation).toBe(false);
    expect(routeAfterDirect(makeState(ret as any))).toBe('learn');
  });

  it('2nd direct: re-entered + another escalation fires → still learn (1-shot cap)', () => {
    const ret = simulateDirectReturn({
      entry: { needsEscalation: true, _promotedThisJob: false },
      loopEscalates: true,
    });
    expect(ret._promotedThisJob).toBe(true);
    expect(ret.needsEscalation).toBe(true);
    // _promotedThisJob=true blocks decompose branch; router drops to learn
    expect(routeAfterDirect(makeState(ret as any))).toBe('learn');
  });

  it('1st direct: no escalation, normal done → learn', () => {
    const ret = simulateDirectReturn({
      entry: { _promotedThisJob: false },
      loopEscalates: false,
    });
    expect(ret._promotedThisJob).toBe(false);
    expect(ret.needsEscalation).toBe(false);
    expect(routeAfterDirect(makeState(ret as any))).toBe('learn');
  });
});
