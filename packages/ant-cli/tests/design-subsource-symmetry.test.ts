/**
 * I10 — Design Sub-Source Symmetry (D24-revised v8)
 *
 * `outputs/design/ui/` and `outputs/design/game-art/` MUST be sub-sourced
 * by the same shape: an `ant/` LLM-generated canonical sub-source plus
 * `figma/` / `handoff/` Phase 5+ hooks. Three guards:
 *
 *   1. The canonical-dirs registry exposes `ant/` for both surfaces.
 *
 *   2. `ARTIFACT_PREFIX` exposes the same set of named constants for both
 *      surfaces (parent + ant + figma + handoff) so prefix-matching code
 *      stays symmetric.
 *
 *   3. `pathsContainGameArtDoc` matches the same sub-source structure as
 *      `pathsContainUiDoc` (both ant/ and the legacy flat path are
 *      tolerated; figma/handoff are pre-registered hooks).
 *
 *   4. `designSubdirOf` and `designDirOf` route `game-art-*.json`
 *      filenames into the sub-sourced canonical (`outputs/design/game-art/ant`).
 *
 *   5. `migrateGameArtToAntSubdir` is wired into `ensureCanonicalStructure`
 *      so existing flat-layout workspaces auto-migrate on next boot
 *      (idempotent invariant).
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
  it('outputs/design/ui registers parent + ant/ + figma/ + handoff/', () => {
    expect(CANONICAL_FEATURE_DIRS).toContain('outputs/design/ui');
    expect(CANONICAL_FEATURE_DIRS).toContain('outputs/design/ui/ant');
    expect(CANONICAL_FEATURE_DIRS).toContain('outputs/design/ui/figma');
    expect(CANONICAL_FEATURE_DIRS).toContain('outputs/design/ui/handoff');
  });

  it('outputs/design/game-art registers parent + ant/ (figma/ / handoff/ are Phase 5+ hooks)', () => {
    expect(CANONICAL_FEATURE_DIRS).toContain('outputs/design/game-art');
    expect(CANONICAL_FEATURE_DIRS).toContain('outputs/design/game-art/ant');
    // figma / handoff sub-sources stay parser-only (`ARTIFACT_PREFIX`
    // exposes the constants but no canonical directory is created until
    // the visual job activates them).
  });
});

describe('I10 — ARTIFACT_PREFIX named constants symmetry', () => {
  it('exposes UI parent + sub-source constants', () => {
    expect(ARTIFACT_PREFIX.UI).toBe('outputs/design/ui/');
    expect(ARTIFACT_PREFIX.UI_ANT).toBe('outputs/design/ui/ant/');
    expect(ARTIFACT_PREFIX.UI_FIGMA).toBe('outputs/design/ui/figma/');
    expect(ARTIFACT_PREFIX.UI_HANDOFF).toBe('outputs/design/ui/handoff/');
  });

  it('exposes game-art parent + sub-source constants (D24-revised v8 — symmetry with UI)', () => {
    expect(ARTIFACT_PREFIX.GAME_ART).toBe('outputs/design/game-art/');
    expect(ARTIFACT_PREFIX.GAME_ART_ANT).toBe('outputs/design/game-art/ant/');
    expect(ARTIFACT_PREFIX.GAME_ART_FIGMA).toBe('outputs/design/game-art/figma/');
    expect(ARTIFACT_PREFIX.GAME_ART_HANDOFF).toBe('outputs/design/game-art/handoff/');
  });

  it('virtual GAME_ART_SPEC prefix points at ant/spec subset (mirrors UI_ANT_SPEC)', () => {
    expect(ARTIFACT_PREFIX.UI_ANT_SPEC).toBe('outputs/design/ui/ant/spec/');
    expect(ARTIFACT_PREFIX.GAME_ART_SPEC).toBe('outputs/design/game-art/ant/spec/');
  });
});

describe('I10 — Sub-source classifier symmetry', () => {
  it.each([
    'outputs/design/ui/ant/ui-tokens.json',
    'outputs/design/ui/ant/ui-spec.json',
    'outputs/design/ui/ant/spec/header',
  ])('uiSourceOfPath classifies %s as ant', (p) => {
    expect(uiSourceOfPath(p)).toBe('ant');
  });

  it.each([
    'outputs/design/ui/figma/figma.json',
    'outputs/design/ui/handoff/some-bundle/index.html',
  ] as const)('uiSourceOfPath classifies %s correctly', (p) => {
    expect(uiSourceOfPath(p)).not.toBeNull();
  });

  it.each([
    ['outputs/design/game-art/ant/game-art-tokens.json', 'ant'],
    ['outputs/design/game-art/ant/game-art-assets.json', 'ant'],
    ['outputs/design/game-art/ant/spec/effects', 'ant'],
    ['outputs/design/game-art/figma/something.json', 'figma'],
    ['outputs/design/game-art/handoff/anything.png', 'handoff'],
  ] as const)('gameArtSourceOfPath classifies %s as %s', (p, expected) => {
    expect(gameArtSourceOfPath(p)).toBe(expected);
  });

  it('gameArtSourceOfPath returns null for non-game-art paths', () => {
    expect(gameArtSourceOfPath('outputs/design/ui/ant/ui-tokens.json')).toBeNull();
    expect(gameArtSourceOfPath('inputs/sources/prd.md')).toBeNull();
  });
});

describe('I10 — pathsContainXDoc symmetry', () => {
  it('pathsContainUiDoc matches any UI sub-source', () => {
    expect(pathsContainUiDoc(['outputs/design/ui/ant/ui-tokens.json'])).toBe(true);
    expect(pathsContainUiDoc(['outputs/design/ui/figma/figma.json'])).toBe(true);
    expect(pathsContainUiDoc(['outputs/design/ui/handoff/page.html'])).toBe(true);
    expect(pathsContainUiDoc(['inputs/sources/prd.md'])).toBe(false);
  });

  it('pathsContainGameArtDoc matches any game-art sub-source (D24-revised v8)', () => {
    expect(pathsContainGameArtDoc(['outputs/design/game-art/ant/game-art-tokens.json'])).toBe(true);
    expect(pathsContainGameArtDoc(['outputs/design/game-art/figma/some.json'])).toBe(true);
    expect(pathsContainGameArtDoc(['outputs/design/game-art/handoff/asset.png'])).toBe(true);
    expect(pathsContainGameArtDoc(['outputs/design/ui/ant/ui-tokens.json'])).toBe(false);
  });

  it('pathsContainGameArtDoc tolerates legacy flat paths (BC for in-flight workspaces)', () => {
    // Workspaces still in transit (post-flat-write but pre-migration) need
    // the predicate to recognise the flat layout — `migrateGameArtToAntSubdir`
    // lifts the file into ant/ on next workspace boot.
    expect(pathsContainGameArtDoc(['outputs/design/game-art/game-art-tokens.json'])).toBe(true);
    expect(pathsContainGameArtDoc(['outputs/design/game-art/game-art-assets.json'])).toBe(true);
  });

  it('pathsContainDesignDoc unions both surfaces', () => {
    expect(pathsContainDesignDoc(['outputs/design/ui/ant/ui-spec.json'])).toBe(true);
    expect(pathsContainDesignDoc(['outputs/design/game-art/ant/game-art-spec.json'])).toBe(true);
    expect(pathsContainDesignDoc(['inputs/sources/prd.md'])).toBe(false);
  });
});

describe('I10 — designSubdirOf / designDirOf route to ant/ sub-source', () => {
  it('UI files route to outputs/design/ui/ant', () => {
    expect(designSubdirOf('ui-tokens.json')).toBe('ui');
    expect(designDirOf('ui-tokens.json')).toBe('outputs/design/ui/ant');
    expect(designDirOf('ui-spec.json')).toBe('outputs/design/ui/ant');
  });

  it('game-art files route to outputs/design/game-art/ant (D24-revised v8 — sub-sourced canonical)', () => {
    expect(designSubdirOf('game-art-tokens.json')).toBe('gameArtAnt');
    expect(designDirOf('game-art-tokens.json')).toBe('outputs/design/game-art/ant');
    expect(designDirOf('game-art-assets.json')).toBe('outputs/design/game-art/ant');
    expect(designDirOf('game-art-spec.json')).toBe('outputs/design/game-art/ant');
  });

  it('non-namespaced files route to system / spec', () => {
    expect(designDirOf('fe-system-main.md')).toBe('outputs/design/system');
    expect(designDirOf('spec-feature.md')).toBe('outputs/design/spec');
  });
});

describe('I10 — Migration helper wired into ensureCanonicalStructure', () => {
  it('ensureCanonicalStructure imports migrateGameArtToAntSubdir for boot-time reconciliation', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const sessionPaths = path.resolve(__dirname, '../src/core/utils/sessionPaths.ts');
    const src = fs.readFileSync(sessionPaths, 'utf8');
    expect(src).toMatch(/migrateGameArtToAntSubdir/);
    expect(src).toMatch(/ensureCanonicalStructure/);
  });

  it('migrateGameArtToAntSubdir module exports the helper + result types', async () => {
    const mod = await import('../src/infrastructure/workspace/migrateGameArtToAntSubdir');
    expect(typeof mod.migrateGameArtToAntSubdir).toBe('function');
  });
});

describe('I10 — game-art sub-source policy registration (artifact-dir-policy)', () => {
  it('registers per-sub-source policies for game-art tree', async () => {
    const { ARTIFACT_DIR_POLICIES } = await import('@ant/shared');
    expect(ARTIFACT_DIR_POLICIES['outputs/design/game-art']).toBeDefined();
    expect(ARTIFACT_DIR_POLICIES['outputs/design/game-art/ant']).toBeDefined();
    expect(ARTIFACT_DIR_POLICIES['outputs/design/game-art/figma']).toBeDefined();
    expect(ARTIFACT_DIR_POLICIES['outputs/design/game-art/handoff']).toBeDefined();
  });

  it('ant/ sub-source admits .json (canonical), parent admits subdirs only', async () => {
    const { ARTIFACT_DIR_POLICIES } = await import('@ant/shared');
    expect(ARTIFACT_DIR_POLICIES['outputs/design/game-art/ant'].acceptedExtensions).toEqual(['.json']);
    expect(ARTIFACT_DIR_POLICIES['outputs/design/game-art/ant'].allowSubdirs).toBe(false);
    expect(ARTIFACT_DIR_POLICIES['outputs/design/game-art'].allowSubdirs).toBe(true);
  });
});
