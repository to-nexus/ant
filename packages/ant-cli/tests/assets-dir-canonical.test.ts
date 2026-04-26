/**
 * Asset-pool canonical layout (Phase 2 — D19-revised)
 *
 * The legacy `inputs/assets/{icons,images,misc}` parent is now subdir-only
 * — its visibility is `ui:inputs` (browseable as the `assets` root) but
 * the children that render under Inputs in the artifacts panel are
 * `service` / `game` instead of the old flat layout.
 *
 * The matrix gate (`TIER_DOMAIN_MATRIX.gameArtTier=['game']`) means a
 * `service` workspace never reaches `inputs/assets/game/`, and a `game`
 * workspace never reaches `inputs/assets/service/`. The canonical
 * directory definitions encode that as `internal` visibility on the
 * domain-specific subtrees so they don't leak into UI listings.
 */

import { describe, it, expect } from 'vitest';
import {
  CANONICAL_FEATURE_DIRS,
  ARTIFACT_PREFIX,
} from '@ant/shared';

describe('inputs/assets/{service,game} canonical layout', () => {
  it('inputs/assets parent is registered (ui:inputs surface)', () => {
    expect(CANONICAL_FEATURE_DIRS).toContain('inputs/assets');
  });

  it('service pool root + child categories are registered', () => {
    const required = [
      'inputs/assets/service',
      'inputs/assets/service/icons',
      'inputs/assets/service/images',
      'inputs/assets/service/fonts',
      'inputs/assets/service/misc',
    ];
    for (const p of required) expect(CANONICAL_FEATURE_DIRS).toContain(p);
  });

  it('game pool root + child categories are registered', () => {
    const required = [
      'inputs/assets/game',
      'inputs/assets/game/icons',
      'inputs/assets/game/images',
      'inputs/assets/game/entities',
      'inputs/assets/game/particles',
      'inputs/assets/game/projectiles',
      'inputs/assets/game/sfx',
      'inputs/assets/game/bgm',
      'inputs/assets/game/tilemaps',
      'inputs/assets/game/atlas',
      'inputs/assets/game/models',
    ];
    for (const p of required) expect(CANONICAL_FEATURE_DIRS).toContain(p);
  });

  it('ARTIFACT_PREFIX exposes the two domain-specific pools as named constants', () => {
    expect(ARTIFACT_PREFIX.ASSETS_SERVICE).toBe('inputs/assets/service/');
    expect(ARTIFACT_PREFIX.ASSETS_GAME).toBe('inputs/assets/game/');
  });

  it('outputs/design/game-art is a flat surface (D24 — no ant/figma/handoff sub-source)', () => {
    expect(ARTIFACT_PREFIX.GAME_ART).toBe('outputs/design/game-art/');
    expect(CANONICAL_FEATURE_DIRS).toContain('outputs/design/game-art');
    // Flat: no `outputs/design/game-art/ant` / `figma` / `handoff` registered.
    for (const sub of ['ant', 'figma', 'handoff']) {
      expect(CANONICAL_FEATURE_DIRS).not.toContain(`outputs/design/game-art/${sub}`);
    }
  });
});
