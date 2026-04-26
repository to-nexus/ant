/**
 * I6 — Asset Surface Boundary (Phase 2 — D19-revised)
 *
 * Asset pools are domain-1:1:
 *   - `inputs/assets/service/` → mapped only by `ui-assets.json`
 *   - `inputs/assets/game/`    → mapped only by `game-art-assets.json`
 *     (`kind: 'external'` entries; `kind: 'inline'` is skipped — it has
 *      no `src` to validate).
 *
 * Cross-references are forbidden. This test asserts the lint gate at
 * a programmatic level — given a synthetic catalog, the validator
 * must flag offenders. The implementation lives in shared helpers
 * (`extractGameArtExternalSrcs` / asset cross-ref helpers) — here we
 * cover the policy with table-driven cases.
 */

import { describe, it, expect } from 'vitest';
import { ARTIFACT_PREFIX } from '@ant/shared';

// ============================================
// Lint helpers (mirrors the BE validators)
// ============================================

interface UiAssetEntry { id: string; src: string }
interface GameArtAssetEntry {
  id: string;
  kind: 'inline' | 'external';
  src?: string;
}

/** Returns offending ui-asset srcs (entries that point outside the service pool). */
function lintUiAssetCatalog(entries: ReadonlyArray<UiAssetEntry>): string[] {
  const offenders: string[] = [];
  for (const e of entries) {
    if (!e.src) continue;
    if (e.src.startsWith(ARTIFACT_PREFIX.ASSETS_GAME)) {
      offenders.push(e.src);
    }
  }
  return offenders;
}

/** Returns offending game-art-asset srcs (kind=external pointing to service pool). */
function lintGameArtAssetCatalog(entries: ReadonlyArray<GameArtAssetEntry>): string[] {
  const offenders: string[] = [];
  for (const e of entries) {
    if (e.kind !== 'external' || !e.src) continue;
    if (e.src.startsWith(ARTIFACT_PREFIX.ASSETS_SERVICE)) {
      offenders.push(e.src);
    }
  }
  return offenders;
}

// ============================================
// I6 cases
// ============================================

describe('I6 — Asset Surface Boundary', () => {
  it('ARTIFACT_PREFIX exposes service / game asset prefixes (canonical)', () => {
    expect(ARTIFACT_PREFIX.ASSETS_SERVICE).toBe('inputs/assets/service/');
    expect(ARTIFACT_PREFIX.ASSETS_GAME).toBe('inputs/assets/game/');
  });

  it('ui-assets.json src may NOT point into inputs/assets/game/...', () => {
    const offending = lintUiAssetCatalog([
      { id: 'logo', src: 'inputs/assets/service/icons/logo.svg' },        // ok
      { id: 'hero', src: 'inputs/assets/service/images/hero.png' },       // ok
      { id: 'sprite', src: 'inputs/assets/game/entities/hero-sprite.svg' }, // I6 violation
    ]);
    expect(offending).toEqual(['inputs/assets/game/entities/hero-sprite.svg']);
  });

  it('game-art-assets.json kind:external may NOT point into inputs/assets/service/...', () => {
    const offending = lintGameArtAssetCatalog([
      { id: 'hero', kind: 'external', src: 'inputs/assets/game/entities/hero.svg' },  // ok
      { id: 'coin', kind: 'inline' },                                                // ok (no src)
      { id: 'logo', kind: 'external', src: 'inputs/assets/service/icons/logo.svg' }, // I6 violation
    ]);
    expect(offending).toEqual(['inputs/assets/service/icons/logo.svg']);
  });

  it('kind:inline entries are exempt (no src to lint)', () => {
    const entries: GameArtAssetEntry[] = [
      { id: 'spark', kind: 'inline' },
      { id: 'coin', kind: 'inline' },
    ];
    expect(lintGameArtAssetCatalog(entries)).toEqual([]);
  });

  it('valid same-domain catalogs produce zero offenders', () => {
    expect(
      lintUiAssetCatalog([
        { id: 'a', src: 'inputs/assets/service/icons/a.svg' },
        { id: 'b', src: 'inputs/assets/service/images/b.png' },
      ]),
    ).toEqual([]);
    expect(
      lintGameArtAssetCatalog([
        { id: 'a', kind: 'external', src: 'inputs/assets/game/entities/a.svg' },
        { id: 'b', kind: 'external', src: 'inputs/assets/game/sfx/b.mp3' },
      ]),
    ).toEqual([]);
  });
});
