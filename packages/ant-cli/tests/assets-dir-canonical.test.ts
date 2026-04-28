/**
 * Asset-pool canonical layout (Phase 2 — D19-revised; domain-rooted v9)
 *
 * The `assets/` parent is the top-level domain root for media inputs.
 * Its visibility is `ui:assets` (browseable as the `assets` root) and
 * the children that render under Assets in the artifacts panel are
 * `service` / `game` (per-domain pools).
 *
 * The matrix gate (`TIER_DOMAIN_MATRIX.gameArtTier=['game']`) means a
 * `service` workspace never reaches `assets/game/`, and a `game`
 * workspace never reaches `assets/service/`. The canonical
 * directory definitions encode that as `internal` visibility on the
 * domain-specific subtrees so they don't leak into UI listings.
 */

import { describe, it, expect } from 'vitest';
import {
  CANONICAL_FEATURE_DIRS,
  ARTIFACT_PREFIX,
} from '@ant/shared';

describe('assets/{service,game} canonical layout', () => {
  it('assets parent is registered (ui:assets surface)', () => {
    expect(CANONICAL_FEATURE_DIRS).toContain('assets');
  });

  it('service pool root + child categories are registered', () => {
    const required = [
      'assets/service',
      'assets/service/icons',
      'assets/service/images',
      'assets/service/fonts',
      'assets/service/misc',
    ];
    for (const p of required) expect(CANONICAL_FEATURE_DIRS).toContain(p);
  });

  it('game pool root + child categories are registered', () => {
    const required = [
      'assets/game',
      'assets/game/icons',
      'assets/game/images',
      'assets/game/entities',
      'assets/game/particles',
      'assets/game/projectiles',
      'assets/game/sfx',
      'assets/game/bgm',
      'assets/game/tilemaps',
      'assets/game/atlas',
      'assets/game/models',
    ];
    for (const p of required) expect(CANONICAL_FEATURE_DIRS).toContain(p);
  });

  it('ARTIFACT_PREFIX exposes the two domain-specific pools as named constants', () => {
    expect(ARTIFACT_PREFIX.ASSETS_SERVICE).toBe('assets/service/');
    expect(ARTIFACT_PREFIX.ASSETS_GAME).toBe('assets/game/');
  });

  it('visual/game-art is sub-sourced (D24-revised v8 — mirrors visual/ui/)', () => {
    expect(ARTIFACT_PREFIX.GAME_ART).toBe('visual/game-art/');
    expect(ARTIFACT_PREFIX.GAME_ART_ANT).toBe('visual/game-art/ant/');
    expect(CANONICAL_FEATURE_DIRS).toContain('visual/game-art');
    expect(CANONICAL_FEATURE_DIRS).toContain('visual/game-art/ant');
    // figma / handoff sub-sources are pre-registered as canonical directories
    // (mirrors visual/ui/ symmetry); the visual job activates them in Phase 5+
    // but the canonical-dirs registry already includes them so prefix-matching
    // and tree creation stay symmetric with the UI surface.
    expect(CANONICAL_FEATURE_DIRS).toContain('visual/game-art/figma');
    expect(CANONICAL_FEATURE_DIRS).toContain('visual/game-art/handoff');
  });
});
