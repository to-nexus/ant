/**
 * Domain Pipeline Compatibility (Phase 1, 10.x)
 *
 * Six fallback / explicit / infer / override scenarios:
 *   1. service-only (legacy) — no domain → effective='service'
 *   2. fallback — domain undefined → effective='service'
 *   3. game-explicit — actionMetadata.domain='game'
 *   4. game-infer — InferredAction.domain='game'
 *   5. infer-fallback — strategy emitted nothing → undefined → service
 *   6. explicit-override — actionMetadata.domain='service' wins over inferred='game'
 */

import { describe, it, expect } from 'vitest';
import {
  getEffectiveDomain,
  mergeWithMetadata,
  type InferredAction,
  type ActionMetadata,
} from '@ant/shared';

function makeInferred(partial: Partial<InferredAction>): InferredAction {
  return { intentId: 'gen-plan', sourceJob: 'plan', ...partial };
}

describe('domain pipeline — getEffectiveDomain', () => {
  it('1. service-only: undefined → service', () => {
    expect(getEffectiveDomain(undefined)).toBe('service');
  });

  it('2. fallback: explicit service stays service', () => {
    expect(getEffectiveDomain('service')).toBe('service');
  });

  it('3. game stays game', () => {
    expect(getEffectiveDomain('game')).toBe('game');
  });
});

describe('domain pipeline — mergeWithMetadata', () => {
  it('3. game-explicit: actionMetadata wins when present', () => {
    const inferred = makeInferred({});
    const meta: ActionMetadata = { domain: 'game' };
    const merged = mergeWithMetadata(inferred, meta);
    expect(merged.domain).toBe('game');
  });

  it('4. game-infer: inferred used when metadata absent', () => {
    const inferred = makeInferred({ domain: 'game' });
    const merged = mergeWithMetadata(inferred);
    expect(merged.domain).toBe('game');
  });

  it('5. infer-fallback: nothing inferred and no metadata → undefined', () => {
    const inferred = makeInferred({});
    const merged = mergeWithMetadata(inferred);
    expect(merged.domain).toBeUndefined();
    // The RAC layer applies `getEffectiveDomain` downstream.
    expect(getEffectiveDomain(merged.domain)).toBe('service');
  });

  it('6. explicit-override: metadata=service beats inferred=game (10.2)', () => {
    const inferred = makeInferred({ domain: 'game' });
    const meta: ActionMetadata = { domain: 'service' };
    const merged = mergeWithMetadata(inferred, meta);
    expect(merged.domain).toBe('service');
  });

  it('explicit-override (game): metadata=game beats inferred=service', () => {
    const inferred = makeInferred({ domain: 'service' });
    const meta: ActionMetadata = { domain: 'game' };
    const merged = mergeWithMetadata(inferred, meta);
    expect(merged.domain).toBe('game');
  });
});
