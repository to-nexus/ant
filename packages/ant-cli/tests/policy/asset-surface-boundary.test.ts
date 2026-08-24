/**
 * I6 — Asset Surface Boundary (Phase 2 — D19-revised)
 *
 * Asset pools are domain-1:1:
 *   - `assets/service/` → mapped only by `ui-assets.json`
 *   - `assets/game/`    → mapped only by `game-art-assets.json`
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
import {
  effectiveAssetInventory,
  formatAssetInventoryBlock,
} from '../../src/infrastructure/workspace/assetInventory';

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
    expect(ARTIFACT_PREFIX.ASSETS_SERVICE).toBe('assets/service/');
    expect(ARTIFACT_PREFIX.ASSETS_GAME).toBe('assets/game/');
  });

  it('ui-assets.json src may NOT point into assets/game/...', () => {
    const offending = lintUiAssetCatalog([
      { id: 'logo', src: 'assets/service/icons/logo.svg' },        // ok
      { id: 'hero', src: 'assets/service/images/hero.png' },       // ok
      { id: 'sprite', src: 'assets/game/entities/hero-sprite.svg' }, // I6 violation
    ]);
    expect(offending).toEqual(['assets/game/entities/hero-sprite.svg']);
  });

  it('game-art-assets.json kind:external may NOT point into assets/service/...', () => {
    const offending = lintGameArtAssetCatalog([
      { id: 'hero', kind: 'external', src: 'assets/game/entities/hero.svg' },  // ok
      { id: 'coin', kind: 'inline' },                                                // ok (no src)
      { id: 'logo', kind: 'external', src: 'assets/service/icons/logo.svg' }, // I6 violation
    ]);
    expect(offending).toEqual(['assets/service/icons/logo.svg']);
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
        { id: 'a', src: 'assets/service/icons/a.svg' },
        { id: 'b', src: 'assets/service/images/b.png' },
      ]),
    ).toEqual([]);
    expect(
      lintGameArtAssetCatalog([
        { id: 'a', kind: 'external', src: 'assets/game/entities/a.svg' },
        { id: 'b', kind: 'external', src: 'assets/game/sfx/b.mp3' },
      ]),
    ).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────
// The placeable-file inventory — pool ∪ attachments
// ────────────────────────────────────────────────────────────────

describe('effectiveAssetInventory — union of the domain pool and this turn\'s attachments', () => {
  const poolOnly = {
    files: ['assets/service/images/logo.png'],
    groups: { images: ['assets/service/images/logo.png'] },
    count: 1,
    sizes: { 'assets/service/images/logo.png': 100 },
    corrupted: {},
  };

  it('an attached binary outside the pool enters the inventory', () => {
    // `indexAssetPool` walks one domain pool root, so this was the ONLY place
    // the code job was ever told real files exist — a plan needing an attached
    // screenshot had exactly one directory to look in, found it empty, and
    // planned a placeholder (near-loading-brace).
    const inv = effectiveAssetInventory({
      assetInventory: poolOnly,
      artifacts: [
        { path: 'visual/ui/handoff/shot.png', kind: 'binary', sizeBytes: 4096 },
      ],
    });
    expect(inv.count).toBe(2);
    expect(inv.files).toContain('visual/ui/handoff/shot.png');
    expect(inv.sizes['visual/ui/handoff/shot.png']).toBe(4096);
    // Grouped by first path segment so the shared formatter needs no special case.
    expect(inv.groups.visual).toEqual(['visual/ui/handoff/shot.png']);
  });

  it('renders every row with its full feature-relative path', () => {
    const block = formatAssetInventoryBlock(
      effectiveAssetInventory({
        assetInventory: poolOnly,
        artifacts: [{ path: 'plan/screenshot.png', kind: 'binary', sizeBytes: 2048 }],
      }),
      { assetsRoot: 'assets/service', usage: 'Place with copy_file.' },
    );
    expect(block).toContain('assets/service/images/logo.png');
    expect(block).toContain('plan/screenshot.png');
  });

  it('text artifacts are documents, not placeable files', () => {
    const inv = effectiveAssetInventory({
      assetInventory: poolOnly,
      artifacts: [{ path: 'plan/prd.md', kind: 'text', sizeBytes: 900 }],
    });
    expect(inv.files).not.toContain('plan/prd.md');
    expect(inv.count).toBe(1);
  });

  it('SVG is admitted despite sniffing as text — it is both', () => {
    const inv = effectiveAssetInventory({
      assetInventory: undefined,
      artifacts: [{ path: 'visual/ui/handoff/icon.svg', kind: 'text', sizeBytes: 300 }],
    });
    expect(inv.files).toEqual(['visual/ui/handoff/icon.svg']);
  });

  it('an attachment already in the pool is not double-counted', () => {
    const inv = effectiveAssetInventory({
      assetInventory: poolOnly,
      artifacts: [
        { path: 'assets/service/images/logo.png', kind: 'binary', sizeBytes: 100 },
      ],
    });
    expect(inv.count).toBe(1);
  });

  it('no attachments → byte-identical to the pool (I6 unchanged)', () => {
    const inv = effectiveAssetInventory({ assetInventory: poolOnly, artifacts: [] });
    expect(inv.files).toEqual(poolOnly.files);
    expect(inv.groups).toEqual(poolOnly.groups);
    expect(inv.count).toBe(1);
  });

  it('the other domain\'s pool is still never observed', () => {
    // The union widens what an EXPLICIT selection can reach; it does not make
    // a disk walk cross domains. Nothing is added that the caller did not pass.
    const inv = effectiveAssetInventory({ assetInventory: poolOnly, artifacts: [] });
    expect(inv.files.some(f => f.startsWith(ARTIFACT_PREFIX.ASSETS_GAME))).toBe(false);
  });
});
