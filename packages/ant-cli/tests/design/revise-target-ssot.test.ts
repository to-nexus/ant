/**
 * Revise-target SSOT — "ref determines target" (rev-ui / rev-game-art).
 *
 * Locks the single discriminator that drives the design revise pipeline:
 * the selected ref sub-source (ant / figma / handoff) decides docFormat +
 * decompose variant + output dir, symmetric across the ui and game-art
 * surfaces. Regression guard for:
 *   - the by-handoff revise crash (handoff → by-handoff, not by-desc)
 *   - the rev-game-art + figma asymmetry (figma → by-figma, was unreachable)
 *   - getDefaultTargetPaths figma-ref → ant trio (was echoing the figma file)
 */

import { describe, it, expect } from 'vitest';
import type { ResolvedArtifact } from '@ant/shared';
import { getDefaultTargetPaths } from '@ant/shared';
import {
  resolveReviseSubSource,
  resolveReviseTarget,
} from '../../src/agents/architect/graph/design/_shared/reviseTarget';

function poolWith(path: string): { artifacts: ResolvedArtifact[] } {
  return { artifacts: [{ path, role: 'ref', content: 'x' }] };
}

describe('resolveReviseTarget — sub-source → (docFormat, variant, targetDir)', () => {
  const cases: Array<{
    surface: 'ui' | 'game-art';
    sub: 'ant' | 'figma' | 'handoff' | null;
    docFormat: 'json' | 'handoff';
    variant: 'by-desc' | 'by-figma' | 'by-handoff';
    dir: string;
  }> = [
    { surface: 'game-art', sub: 'ant', docFormat: 'json', variant: 'by-desc', dir: 'visual/game-art/ant' },
    { surface: 'game-art', sub: 'figma', docFormat: 'json', variant: 'by-figma', dir: 'visual/game-art/ant' },
    { surface: 'game-art', sub: 'handoff', docFormat: 'handoff', variant: 'by-handoff', dir: 'visual/game-art/handoff' },
    { surface: 'ui', sub: 'ant', docFormat: 'json', variant: 'by-desc', dir: 'visual/ui/ant' },
    { surface: 'ui', sub: 'figma', docFormat: 'json', variant: 'by-figma', dir: 'visual/ui/ant' },
    { surface: 'ui', sub: 'handoff', docFormat: 'handoff', variant: 'by-handoff', dir: 'visual/ui/handoff' },
    // null (no source detected) degrades to the ant JSON contract.
    { surface: 'game-art', sub: null, docFormat: 'json', variant: 'by-desc', dir: 'visual/game-art/ant' },
    { surface: 'ui', sub: null, docFormat: 'json', variant: 'by-desc', dir: 'visual/ui/ant' },
  ];

  for (const c of cases) {
    it(`${c.surface} × ${c.sub ?? 'null'} → ${c.docFormat}/${c.variant}/${c.dir}`, () => {
      const r = resolveReviseTarget(c.sub, c.surface);
      expect(r.docFormat).toBe(c.docFormat);
      expect(r.variant).toBe(c.variant);
      expect(r.targetDir).toBe(c.dir);
    });
  }

  it('handoff never routes to by-desc (the crash regression)', () => {
    expect(resolveReviseTarget('handoff', 'game-art').variant).toBe('by-handoff');
    expect(resolveReviseTarget('handoff', 'ui').variant).toBe('by-handoff');
  });

  it('figma routes to by-figma symmetrically (game-art asymmetry fix)', () => {
    expect(resolveReviseTarget('figma', 'game-art').variant).toBe('by-figma');
    expect(resolveReviseTarget('figma', 'ui').variant).toBe('by-figma');
  });
});

describe('resolveReviseSubSource — reads the RAC pool', () => {
  it('classifies each game-art sub-source from the pool path', () => {
    expect(resolveReviseSubSource(poolWith('visual/game-art/ant/game-art-spec.json'), 'game-art')).toBe('ant');
    expect(resolveReviseSubSource(poolWith('visual/game-art/figma/figma.json'), 'game-art')).toBe('figma');
    expect(resolveReviseSubSource(poolWith('visual/game-art/handoff/DESIGN.md'), 'game-art')).toBe('handoff');
  });

  it('classifies each ui sub-source from the pool path', () => {
    expect(resolveReviseSubSource(poolWith('visual/ui/ant/ui-spec.json'), 'ui')).toBe('ant');
    expect(resolveReviseSubSource(poolWith('visual/ui/figma/figma.json'), 'ui')).toBe('figma');
    expect(resolveReviseSubSource(poolWith('visual/ui/handoff/DESIGN.md'), 'ui')).toBe('handoff');
  });

  it('returns null for an empty pool (no design source)', () => {
    expect(resolveReviseSubSource({ artifacts: [] }, 'game-art')).toBeNull();
    expect(resolveReviseSubSource({ artifacts: [{ path: 'plan/prd.md', role: 'context', content: 'x' }] }, 'game-art')).toBeNull();
  });
});

describe('getDefaultTargetPaths — revise ref determines target', () => {
  it('game-art figma ref → ant JSON trio (regenerate/sync), NOT the figma file', () => {
    const t = getDefaultTargetPaths('rev-game-art', undefined, { refs: ['visual/game-art/figma/figma.json'] });
    expect(t).toEqual([
      'visual/game-art/ant/game-art-tokens.json',
      'visual/game-art/ant/game-art-assets.json',
      'visual/game-art/ant/game-art-spec.json',
    ]);
  });

  it('ui figma ref → ui ant trio', () => {
    const t = getDefaultTargetPaths('rev-ui', undefined, { refs: ['visual/ui/figma/figma.json'] });
    expect(t).toEqual([
      'visual/ui/ant/ui-tokens.json',
      'visual/ui/ant/ui-assets.json',
      'visual/ui/ant/ui-spec.json',
    ]);
  });

  it('ant / handoff refs revise in place → the selected ref IS the target', () => {
    expect(getDefaultTargetPaths('rev-game-art', undefined, { refs: ['visual/game-art/ant/game-art-spec.json'] }))
      .toEqual(['visual/game-art/ant/game-art-spec.json']);
    expect(getDefaultTargetPaths('rev-game-art', undefined, { refs: ['visual/game-art/handoff'] }))
      .toEqual(['visual/game-art/handoff']);
  });

  it('multi-ref handoff bundle revise → the refs ARE the target (was undefined)', () => {
    const bundle = [
      'visual/game-art/handoff/README.md',
      'visual/game-art/handoff/project/design/tokens/DesignTokens.dc.html',
      'visual/game-art/handoff/project/design/screens/GameScreen.dc.html',
    ];
    expect(getDefaultTargetPaths('rev-game-art', undefined, { refs: bundle })).toEqual(bundle);

    const uiBundle = ['visual/ui/handoff/site/index.html', 'visual/ui/handoff/site/styles.css'];
    expect(getDefaultTargetPaths('rev-ui', undefined, { refs: uiBundle })).toEqual(uiBundle);
  });

  it('non-design revise keeps single-select semantics (≥2 refs stay invalid)', () => {
    expect(getDefaultTargetPaths('rev-spec', undefined, { refs: ['architecture/spec/a.md', 'architecture/spec/b.md'] }))
      .toBeUndefined();
    expect(getDefaultTargetPaths('rev-spec', undefined, { refs: ['architecture/spec/a.md'] }))
      .toEqual(['architecture/spec/a.md']);
  });

  it('design revise with no refs stays undefined (useExplicitAutoSync contract)', () => {
    expect(getDefaultTargetPaths('rev-ui', undefined)).toBeUndefined();
    expect(getDefaultTargetPaths('rev-game-art', undefined, { refs: [] })).toBeUndefined();
  });
});
