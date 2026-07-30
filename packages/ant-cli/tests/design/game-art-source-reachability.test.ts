/**
 * Game-art revise sub-source reachability + target granularity.
 *
 * Two defects this locks:
 *
 *   1. `rev-game-art` offered three sub-sources but only `handoff` was ever
 *      selectable. `ant` lost its non-figma producer at `75e3b5d79` (which
 *      repointed `gen-game-art-desc` at the handoff bundle), and the game-art
 *      `figma` sub-source had no writer at all because `FIGMA_CONFIG_PATH` was
 *      hardcoded to the UI tree. Fix: `ant` is dropped from the revise refs
 *      (it is the figma pipeline's OUTPUT, not a source) and the figma workfile
 *      reference becomes domain-symmetric via `figmaConfigPathFor`.
 *
 *   2. Directory-granular targets were enumerated file-by-file. Fix: an explicit
 *      `dirLevel` axis on the matrix `generate` target plus the handoff
 *      bundle-dir widening on the revise path.
 */

import { describe, it, expect } from 'vitest';
import {
  CANONICAL_FEATURE_FILE_PATHS,
  FIGMA_CONFIG_PATH,
  FIGMA_CONFIG_PATHS,
  GAME_ART_FIGMA_CONFIG_PATH,
  figmaConfigPathFor,
  gameArtSourceOfPath,
  uiSourceOfPath,
  getConfigSlots,
  getDefaultTargetPaths,
  isDirLevelTarget,
  isFigmaPipeline,
  type IntentId,
  type UiSource,
} from '@ant/shared';
import { CANONICAL_FEATURE_FILES } from '../../src/core/utils/sessionPaths';

const subgroupIds = (intent: IntentId): UiSource[] => {
  const slot = getConfigSlots(intent)?.refs.find(r => r.type === 'ui-source');
  return (slot?.uiSources ?? []).map(s => s.id);
};

describe('figma workfile reference is domain-symmetric', () => {
  it('resolves per domain and defaults to the service surface', () => {
    expect(figmaConfigPathFor('service')).toBe(FIGMA_CONFIG_PATH);
    expect(figmaConfigPathFor('game')).toBe(GAME_ART_FIGMA_CONFIG_PATH);
    // An unknown / missing domain must not crash and must not leak the game
    // surface into a service workspace.
    expect(figmaConfigPathFor(undefined)).toBe(FIGMA_CONFIG_PATH);
  });

  it('both locations are canonical files with a content factory', () => {
    for (const p of FIGMA_CONFIG_PATHS) {
      expect(CANONICAL_FEATURE_FILE_PATHS).toContain(p);
      // A canonical path without a factory throws at module load; assert the
      // derived list carries both so `ensureCanonicalStructure` creates them.
      expect(CANONICAL_FEATURE_FILES.map(f => f.relativePath)).toContain(p);
    }
  });

  it('each location classifies into its own surface sub-source', () => {
    expect(uiSourceOfPath(FIGMA_CONFIG_PATH)).toBe('figma');
    expect(gameArtSourceOfPath(GAME_ART_FIGMA_CONFIG_PATH)).toBe('figma');
    // The old cross-tree ref made the game-art figma path unclassifiable,
    // which silently degraded the revise pipeline to the ant `by-desc` variant.
    expect(gameArtSourceOfPath(FIGMA_CONFIG_PATH)).toBeNull();
  });

  it('gen-game-art-figma refs the game-surface workfile, not the UI tree', () => {
    const refs = getConfigSlots('gen-game-art-figma')?.refs ?? [];
    expect(refs.map(r => r.path)).toEqual([GAME_ART_FIGMA_CONFIG_PATH]);
  });

  it('a figma-sourced revise is a figma pipeline on BOTH surfaces', () => {
    expect(isFigmaPipeline('rev-ui', true)).toBe(true);
    expect(isFigmaPipeline('rev-game-art', true)).toBe(true);
    expect(isFigmaPipeline('gen-game-art-figma', false)).toBe(true);
    expect(isFigmaPipeline('rev-game-art', false)).toBe(false);
  });
});

describe('revise refs offer authored sources only', () => {
  it('rev-game-art / rev-ui drop `ant` (an output format, not a source)', () => {
    expect(subgroupIds('rev-game-art')).toEqual(['figma', 'handoff']);
    expect(subgroupIds('rev-ui')).toEqual(['figma', 'handoff']);
  });

  it('read-only explain refs and code-job context keep all three', () => {
    expect(subgroupIds('explain-game-art')).toEqual(['ant', 'figma', 'handoff']);
    // The code job consumes the ant trio — narrowing its context slot would
    // starve `ui-source-dispatch`.
    const ctx = getConfigSlots('gen-code-spec')?.context ?? [];
    const gameArtCtx = ctx.find(c => c.path === 'visual/game-art');
    const uiCtx = ctx.find(c => c.path === 'visual/ui');
    expect((gameArtCtx?.uiSources ?? []).map(s => s.id)).toEqual(['ant', 'figma', 'handoff']);
    expect((uiCtx?.uiSources ?? []).map(s => s.id)).toEqual(['ant', 'figma', 'handoff']);
  });
});

describe('target granularity', () => {
  it('handoff producers declare a directory-level target', () => {
    for (const intent of ['gen-game-art-desc', 'gen-ui-desc'] as IntentId[]) {
      const target = getConfigSlots(intent)!.target;
      expect(isDirLevelTarget(target)).toBe(true);
      expect(getDefaultTargetPaths(intent)).toHaveLength(1);
    }
    expect(getDefaultTargetPaths('gen-game-art-desc')).toEqual(['visual/game-art/handoff']);
    expect(getDefaultTargetPaths('gen-ui-desc')).toEqual(['visual/ui/handoff']);
  });

  it('an empty outputs list is still directory-level (subsumed rule)', () => {
    // `gen-visual-*` lets the LLM name every file under `assets/gen`, so the
    // directory has always been the target. The new `dirLevel` flag must not
    // regress that pre-existing case.
    const target = getConfigSlots('gen-visual-logo')!.target;
    expect(target.kind).toBe('generate');
    expect(isDirLevelTarget(target)).toBe(true);
    expect(getDefaultTargetPaths('gen-visual-logo')).toEqual(['assets/gen']);
  });

  it('named-document targets stay file-level', () => {
    const target = getConfigSlots('gen-game-art-figma')!.target;
    expect(isDirLevelTarget(target)).toBe(false);
    expect(getDefaultTargetPaths('gen-game-art-figma')).toEqual([
      'visual/game-art/ant/game-art-tokens.json',
      'visual/game-art/ant/game-art-assets.json',
      'visual/game-art/ant/game-art-spec.json',
    ]);
  });

  it('a figma revise ref maps to the ant trio (ref ≠ target)', () => {
    expect(getDefaultTargetPaths('rev-game-art', undefined, { refs: [GAME_ART_FIGMA_CONFIG_PATH] }))
      .toEqual([
        'visual/game-art/ant/game-art-tokens.json',
        'visual/game-art/ant/game-art-assets.json',
        'visual/game-art/ant/game-art-spec.json',
      ]);
  });
});
