/**
 * I10 — Design Sub-Source Symmetry (D24-revised v8)
 *
 * `visual/ui/` and `visual/game-art/` MUST be sub-sourced
 * by the same shape: an `ant/` LLM-generated canonical sub-source plus
 * `figma/` / `handoff/` Phase 5+ hooks. Four guards:
 *
 *   1. The canonical-dirs registry exposes `ant/` for both surfaces.
 *
 *   2. `ARTIFACT_PREFIX` exposes the same set of named constants for both
 *      surfaces (parent + ant + figma + handoff) so prefix-matching code
 *      stays symmetric.
 *
 *   3. `pathsContainGameArtDoc` matches the same sub-source structure as
 *      `pathsContainUiDoc` (ant/ + figma/ + handoff/). Flat layout
 *      classification was removed in Phase A — only the three sub-source
 *      prefixes qualify.
 *
 *   4. `designSubdirOf` and `designDirOf` route `game-art-*.json`
 *      filenames into the sub-sourced canonical (`visual/game-art/ant`).
 */

import { describe, it, expect } from 'vitest';
import {
  ARTIFACT_PREFIX,
  CANONICAL_FEATURE_DIRS,
  designSubdirOf,
  designDirOf,
  uiSourceOfPath,
  gameArtSourceOfPath,
  pathsContainUiDoc,
  pathsContainGameArtDoc,
  pathsContainDesignDoc,
} from '@ant/shared';

describe('I10 — Canonical directory registry symmetry', () => {
  it('visual/ui registers parent + ant/ + figma/ + handoff/', () => {
    expect(CANONICAL_FEATURE_DIRS).toContain('visual/ui');
    expect(CANONICAL_FEATURE_DIRS).toContain('visual/ui/ant');
    expect(CANONICAL_FEATURE_DIRS).toContain('visual/ui/figma');
    expect(CANONICAL_FEATURE_DIRS).toContain('visual/ui/handoff');
  });

  it('visual/game-art registers parent + ant/ (figma/ / handoff/ are Phase 5+ hooks)', () => {
    expect(CANONICAL_FEATURE_DIRS).toContain('visual/game-art');
    expect(CANONICAL_FEATURE_DIRS).toContain('visual/game-art/ant');
    // figma / handoff sub-sources stay parser-only (`ARTIFACT_PREFIX`
    // exposes the constants but no canonical directory is created until
    // the visual job activates them).
  });
});

describe('I10 — ARTIFACT_PREFIX named constants symmetry', () => {
  it('exposes UI parent + sub-source constants', () => {
    expect(ARTIFACT_PREFIX.UI).toBe('visual/ui/');
    expect(ARTIFACT_PREFIX.UI_ANT).toBe('visual/ui/ant/');
    expect(ARTIFACT_PREFIX.UI_FIGMA).toBe('visual/ui/figma/');
    expect(ARTIFACT_PREFIX.UI_HANDOFF).toBe('visual/ui/handoff/');
  });

  it('exposes game-art parent + sub-source constants (D24-revised v8 — symmetry with UI)', () => {
    expect(ARTIFACT_PREFIX.GAME_ART).toBe('visual/game-art/');
    expect(ARTIFACT_PREFIX.GAME_ART_ANT).toBe('visual/game-art/ant/');
    expect(ARTIFACT_PREFIX.GAME_ART_FIGMA).toBe('visual/game-art/figma/');
    expect(ARTIFACT_PREFIX.GAME_ART_HANDOFF).toBe('visual/game-art/handoff/');
  });

  it('virtual GAME_ART_SPEC prefix points at ant/spec subset (mirrors UI_ANT_SPEC)', () => {
    expect(ARTIFACT_PREFIX.UI_ANT_SPEC).toBe('visual/ui/ant/spec/');
    expect(ARTIFACT_PREFIX.GAME_ART_SPEC).toBe('visual/game-art/ant/spec/');
  });
});

describe('I10 — Sub-source classifier symmetry', () => {
  it.each([
    'visual/ui/ant/ui-tokens.json',
    'visual/ui/ant/ui-spec.json',
    'visual/ui/ant/spec/header',
  ])('uiSourceOfPath classifies %s as ant', (p) => {
    expect(uiSourceOfPath(p)).toBe('ant');
  });

  it.each([
    'visual/ui/figma/figma.json',
    'visual/ui/handoff/some-bundle/index.html',
  ] as const)('uiSourceOfPath classifies %s correctly', (p) => {
    expect(uiSourceOfPath(p)).not.toBeNull();
  });

  it.each([
    ['visual/game-art/ant/game-art-tokens.json', 'ant'],
    ['visual/game-art/ant/game-art-assets.json', 'ant'],
    ['visual/game-art/ant/spec/effects', 'ant'],
    ['visual/game-art/figma/something.json', 'figma'],
    ['visual/game-art/handoff/anything.png', 'handoff'],
  ] as const)('gameArtSourceOfPath classifies %s as %s', (p, expected) => {
    expect(gameArtSourceOfPath(p)).toBe(expected);
  });

  it('gameArtSourceOfPath returns null for non-game-art paths', () => {
    expect(gameArtSourceOfPath('visual/ui/ant/ui-tokens.json')).toBeNull();
    expect(gameArtSourceOfPath('plan/prd.md')).toBeNull();
  });
});

describe('I10 — pathsContainXDoc symmetry', () => {
  it('pathsContainUiDoc matches any UI sub-source', () => {
    expect(pathsContainUiDoc(['visual/ui/ant/ui-tokens.json'])).toBe(true);
    expect(pathsContainUiDoc(['visual/ui/figma/figma.json'])).toBe(true);
    expect(pathsContainUiDoc(['visual/ui/handoff/page.html'])).toBe(true);
    expect(pathsContainUiDoc(['plan/prd.md'])).toBe(false);
  });

  it('pathsContainGameArtDoc matches any game-art sub-source (D24-revised v8)', () => {
    expect(pathsContainGameArtDoc(['visual/game-art/ant/game-art-tokens.json'])).toBe(true);
    expect(pathsContainGameArtDoc(['visual/game-art/figma/some.json'])).toBe(true);
    expect(pathsContainGameArtDoc(['visual/game-art/handoff/asset.png'])).toBe(true);
    expect(pathsContainGameArtDoc(['visual/ui/ant/ui-tokens.json'])).toBe(false);
  });

  it('pathsContainGameArtDoc rejects flat paths (single-direction; no BC)', () => {
    // Phase A removed the BC regex — only the three sub-source prefixes
    // (`ant/` / `figma/` / `handoff/`) qualify. Flat paths under the
    // game-art parent are NOT recognized as game-art docs.
    expect(pathsContainGameArtDoc(['visual/game-art/game-art-tokens.json'])).toBe(false);
    expect(pathsContainGameArtDoc(['visual/game-art/game-art-assets.json'])).toBe(false);
  });

  it('pathsContainDesignDoc unions both surfaces', () => {
    expect(pathsContainDesignDoc(['visual/ui/ant/ui-spec.json'])).toBe(true);
    expect(pathsContainDesignDoc(['visual/game-art/ant/game-art-spec.json'])).toBe(true);
    expect(pathsContainDesignDoc(['plan/prd.md'])).toBe(false);
  });
});

describe('I10 — designSubdirOf / designDirOf route to ant/ sub-source', () => {
  it('UI files route to visual/ui/ant', () => {
    expect(designSubdirOf('ui-tokens.json')).toBe('ui');
    expect(designDirOf('ui-tokens.json')).toBe('visual/ui/ant');
    expect(designDirOf('ui-spec.json')).toBe('visual/ui/ant');
  });

  it('game-art files route to visual/game-art/ant (D24-revised v8 — sub-sourced canonical)', () => {
    expect(designSubdirOf('game-art-tokens.json')).toBe('gameArt');
    expect(designDirOf('game-art-tokens.json')).toBe('visual/game-art/ant');
    expect(designDirOf('game-art-assets.json')).toBe('visual/game-art/ant');
    expect(designDirOf('game-art-spec.json')).toBe('visual/game-art/ant');
  });

  it('non-namespaced files route to system / spec', () => {
    expect(designDirOf('fe-system-main.md')).toBe('architecture/system');
    expect(designDirOf('spec-feature.md')).toBe('architecture/spec');
  });
});

describe('I10 — game-art sub-source policy registration (artifact-dir-policy)', () => {
  it('registers per-sub-source policies for game-art tree', async () => {
    const { ARTIFACT_DIR_POLICIES } = await import('@ant/shared');
    expect(ARTIFACT_DIR_POLICIES['visual/game-art']).toBeDefined();
    expect(ARTIFACT_DIR_POLICIES['visual/game-art/ant']).toBeDefined();
    expect(ARTIFACT_DIR_POLICIES['visual/game-art/figma']).toBeDefined();
    expect(ARTIFACT_DIR_POLICIES['visual/game-art/handoff']).toBeDefined();
  });

  it('ant/ sub-source admits .json (canonical), parent admits subdirs only', async () => {
    const { ARTIFACT_DIR_POLICIES } = await import('@ant/shared');
    expect(ARTIFACT_DIR_POLICIES['visual/game-art/ant'].acceptedExtensions).toEqual(['.json']);
    expect(ARTIFACT_DIR_POLICIES['visual/game-art/ant'].allowSubdirs).toBe(false);
    expect(ARTIFACT_DIR_POLICIES['visual/game-art'].allowSubdirs).toBe(true);
  });
});
