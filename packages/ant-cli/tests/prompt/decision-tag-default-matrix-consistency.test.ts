/**
 * D40 (v9) — Decision Default × Matrix Consistency
 *
 * `DecisionTagRegistry`'s `defaultOnRetryExhaustion` values are the
 * fallback the system applies when the LLM exhausts inline retry without
 * emitting a parseable tag. Every fallback MUST satisfy the registry /
 * matrix predicates that the live decision pipeline enforces — otherwise
 * the system would default to a value that the parser itself rejects.
 *
 * Three predicates:
 *
 *   (a) `gameContentTier.defaultOnRetryExhaustion = { genre, coreLoop }`
 *       — `genre ∈ GAME_GENRE_VARIANTS`, `coreLoop ∈ GAME_CORE_LOOP_VARIANTS`,
 *         and `(genre, coreLoop)` ∈ `GENRE_CORELOOP_MATRIX[genre]` (I9).
 *
 *   (b) `gameArtTier.defaultOnRetryExhaustion = { concept, perspective,
 *        entityCatalog, motionPattern, particleProfile, projectilePolicy,
 *        audioProfile }` — every axis value lives in its respective
 *        `GAME_ART_*_VARIANTS` array.
 *
 *   (c) `domain.defaultOnRetryExhaustion ∈ { 'service', 'game' }`.
 *
 * Auxiliary: `SUPPORTED_GAME_ENGINES` is a single-element registry today
 * (D29 — `['phaser']`); the deterministic gameEngine fallback is the only
 * possible value, but we still pin the cardinality so a future widen
 * (Phase 5+ — godot / cocos-creator / babylon / three) is paired with a
 * deliberate audit of the implicit default.
 *
 * Why this guard exists: a future matrix widening / narrowing or a
 * variant-set rename can leave the default un-rebased. The check is cheap
 * (registry + lookup) but the cost of a stale default is a parser-time
 * rejection in the field, so the lint runs as a static gate.
 */

import { describe, it, expect } from 'vitest';
import {
  GAME_GENRE_VARIANTS,
  GAME_CORE_LOOP_VARIANTS,
  GENRE_CORELOOP_MATRIX,
  GAME_ART_CONCEPT_VARIANTS,
  GAME_ART_PERSPECTIVE_VARIANTS,
  GAME_ART_ENTITY_CATALOG_VARIANTS,
  GAME_ART_MOTION_PATTERN_VARIANTS,
  GAME_ART_PARTICLE_PROFILE_VARIANTS,
  GAME_ART_PROJECTILE_POLICY_VARIANTS,
  GAME_ART_AUDIO_PROFILE_VARIANTS,
  SUPPORTED_GAME_ENGINES,
} from '@ant/shared';
import { DECISION_TAG_REGISTRY } from '../../src/core/llm-response/DecisionTagRegistry';

interface TagDef<T> {
  readonly name: string;
  readonly defaultOnRetryExhaustion?: T;
}

function findTag<T = unknown>(name: string): TagDef<T> {
  const def = DECISION_TAG_REGISTRY.find(d => (d as TagDef<unknown>).name === name) as TagDef<T> | undefined;
  if (!def) throw new Error(`DECISION_TAG_REGISTRY missing tag "${name}"`);
  return def;
}

describe('D40 — Decision Default × Matrix Consistency', () => {
  describe('domain default ∈ Domain union', () => {
    it('domain.defaultOnRetryExhaustion is one of {service, game}', () => {
      const def = findTag<string>('domain');
      expect(['service', 'game']).toContain(def.defaultOnRetryExhaustion);
    });
  });

  describe('gameContentTier default × matrix (I9)', () => {
    const def = findTag<{ genre?: string; coreLoop?: string }>('gameContentTier');

    it('default genre ∈ GAME_GENRE_VARIANTS', () => {
      const g = def.defaultOnRetryExhaustion?.genre;
      expect(g).toBeDefined();
      expect(GAME_GENRE_VARIANTS as readonly string[]).toContain(g!);
    });

    it('default coreLoop ∈ GAME_CORE_LOOP_VARIANTS', () => {
      const c = def.defaultOnRetryExhaustion?.coreLoop;
      expect(c).toBeDefined();
      expect(GAME_CORE_LOOP_VARIANTS as readonly string[]).toContain(c!);
    });

    it('default (genre, coreLoop) pair satisfies GENRE_CORELOOP_MATRIX', () => {
      const { genre, coreLoop } = def.defaultOnRetryExhaustion ?? {};
      expect(genre).toBeDefined();
      expect(coreLoop).toBeDefined();
      const allowed = GENRE_CORELOOP_MATRIX[genre as keyof typeof GENRE_CORELOOP_MATRIX];
      expect(allowed).toBeDefined();
      expect(allowed as readonly string[]).toContain(coreLoop!);
    });
  });

  describe('gameArtTier default × 7-axis registry', () => {
    const def = findTag<Record<string, string | undefined>>('gameArtTier');
    const d = def.defaultOnRetryExhaustion ?? {};

    const cases: Array<[string, ReadonlyArray<string>]> = [
      ['concept', GAME_ART_CONCEPT_VARIANTS as ReadonlyArray<string>],
      ['perspective', GAME_ART_PERSPECTIVE_VARIANTS as ReadonlyArray<string>],
      ['entityCatalog', GAME_ART_ENTITY_CATALOG_VARIANTS as ReadonlyArray<string>],
      ['motionPattern', GAME_ART_MOTION_PATTERN_VARIANTS as ReadonlyArray<string>],
      ['particleProfile', GAME_ART_PARTICLE_PROFILE_VARIANTS as ReadonlyArray<string>],
      ['projectilePolicy', GAME_ART_PROJECTILE_POLICY_VARIANTS as ReadonlyArray<string>],
      ['audioProfile', GAME_ART_AUDIO_PROFILE_VARIANTS as ReadonlyArray<string>],
    ];

    it.each(cases)('default %s ∈ registry variants', (axis, variants) => {
      const v = d[axis];
      expect(v).toBeDefined();
      expect(variants).toContain(v!);
    });

    it('default carries all 7 axes (Phase 4 emit)', () => {
      const expected = ['concept', 'perspective', 'entityCatalog', 'motionPattern', 'particleProfile', 'projectilePolicy', 'audioProfile'];
      for (const axis of expected) {
        expect(d[axis]).toBeDefined();
      }
    });
  });

  describe('gameEngine registry pin (D29)', () => {
    it('SUPPORTED_GAME_ENGINES is a single-element registry today (Phase 5+ hook to widen)', () => {
      expect(SUPPORTED_GAME_ENGINES.length).toBe(1);
      expect(SUPPORTED_GAME_ENGINES[0]).toBe('phaser');
    });
  });
});
