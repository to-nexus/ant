/**
 * Game-Art Handoff Phase-Alignment (WS2 §3)
 *
 * Locks the game-art source funnel + handoff wiring to symmetry with the UI
 * surface:
 *   §3A — generic source funnel instances (GAME_ART_SOURCE_PRIORITY + pickers)
 *   §3B — RAC subgroup slot shape (via canonical helpers)
 *   §3C — handoff paths stub-load (not eager) + game-art exclusivity throws
 *   §3D — game-art-source-dispatch selects the handoff partial
 * Plus the shared assetValidation helper that both the serial and parallel
 * completion nodes call (§1d parallel-hole single-owner).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  GAME_ART_SOURCE_PRIORITY,
  UI_SOURCE_PRIORITY,
  gameArtSourceOfPath,
  pickGameArtSource,
  normalizeGameArtSourceRefs,
  pickGameArtSourceSubgroupDir,
  isGameArtTreeParentPath,
} from '@ant/shared';
import { loadResolvedArtifacts } from '../../src/agents/common/graph/loadDocumentsForRAC';
import { ArtifactPoolView } from '../../src/core/artifact/ArtifactPipeline';
import {
  validateAssetReferences,
  buildAssetRetryMessage,
  isAssetTask,
} from '../../src/agents/architect/graph/design/nodes/checkTaskStatus/assetValidation';
import { FilePromptAdapter, initPartials } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATES_DIR = join(__dirname, '../../src/core/prompt/templates');

describe('WS2 §3A — game-art source funnel (symmetric with UI)', () => {
  it('GAME_ART_SOURCE_PRIORITY mirrors UI_SOURCE_PRIORITY order', () => {
    expect(GAME_ART_SOURCE_PRIORITY).toEqual(['ant', 'figma', 'handoff']);
    expect(GAME_ART_SOURCE_PRIORITY).toEqual(UI_SOURCE_PRIORITY);
  });

  it('gameArtSourceOfPath classifies each sub-source', () => {
    expect(gameArtSourceOfPath('visual/game-art/ant/game-art-spec.json')).toBe('ant');
    expect(gameArtSourceOfPath('visual/game-art/figma/figma.json')).toBe('figma');
    expect(gameArtSourceOfPath('visual/game-art/handoff/hero.png')).toBe('handoff');
    expect(gameArtSourceOfPath('visual/ui/ant/ui-spec.json')).toBeNull();
  });

  it('pickGameArtSource / normalize honor ant > figma > handoff', () => {
    const mixed = ['visual/game-art/handoff/a.png', 'visual/game-art/ant/game-art-spec.json'];
    expect(pickGameArtSource(mixed)).toBe('ant');
    expect(normalizeGameArtSourceRefs(mixed)).toEqual(['visual/game-art/ant/game-art-spec.json']);
  });

  it('pickGameArtSourceSubgroupDir returns the highest-priority valid subgroup', () => {
    const subs = [
      { id: 'ant' as const, dir: 'visual/game-art/ant', hasValidFiles: false },
      { id: 'handoff' as const, dir: 'visual/game-art/handoff', hasValidFiles: true },
    ];
    expect(pickGameArtSourceSubgroupDir(subs)).toBe('visual/game-art/handoff');
  });

  it('isGameArtTreeParentPath flags the un-narrowed parent only', () => {
    expect(isGameArtTreeParentPath('visual/game-art')).toBe(true);
    expect(isGameArtTreeParentPath('visual/game-art/ant/game-art-spec.json')).toBe(false);
    expect(isGameArtTreeParentPath('visual/ui')).toBe(false);
  });
});

describe('WS2 §3C — game-art handoff pool loading', () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(join(os.tmpdir(), 'ga-handoff-'));
    fs.mkdirSync(join(dir, 'visual/game-art/handoff'), { recursive: true });
    fs.writeFileSync(join(dir, 'visual/game-art/handoff/notes.md'), '# Bundle guide\nuse hero.png', 'utf-8');
    fs.writeFileSync(join(dir, 'visual/game-art/handoff/hero.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  const rac = (refs: string[]) => ({ intent: 'gen-code-directive', refs, context: [] } as any);

  it('handoff dir ref loads STUBS (not eager content), no throw', () => {
    const pool = loadResolvedArtifacts(rac(['visual/game-art/handoff']), dir);
    expect(pool.length).toBeGreaterThanOrEqual(2);
    const md = pool.find(a => a.path.endsWith('notes.md'));
    const png = pool.find(a => a.path.endsWith('hero.png'));
    // text stub → read_file hint (not the file body)
    expect(md?.content).toMatch(/handoff file|read_file/);
    expect(md?.content).not.toContain('use hero.png');
    // binary stub → path-only pointer
    expect(png?.content).toMatch(/handoff asset|do NOT call read_file/i);
    expect(new ArtifactPoolView(pool).gameArtSource()).toBe('handoff');
  });

  it('mixed game-art sources (ant + handoff) throw the exclusivity guard', () => {
    const mixed = rac(['visual/game-art/ant/game-art-spec.json', 'visual/game-art/handoff/hero.png']);
    expect(() => loadResolvedArtifacts(mixed, dir)).toThrow(/mixed GameArtSource/);
  });
});

describe('WS2 §1d — shared assetValidation (serial + parallel single-owner)', () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(join(os.tmpdir(), 'ga-assetval-'));
    fs.mkdirSync(join(dir, 'visual/game-art/ant'), { recursive: true });
  });

  const write = (json: unknown) =>
    fs.writeFileSync(join(dir, 'visual/game-art/ant/game-art-assets.json'), JSON.stringify(json), 'utf-8');

  it('isAssetTask recognizes both surfaces', () => {
    expect(isAssetTask('game-art-assets-entities')).toBe(true);
    expect(isAssetTask('ui-assets-icons')).toBe(true);
    expect(isAssetTask('game-art-tokens')).toBe(false);
  });

  it('flags a dangling external src', async () => {
    write({ _meta: {}, entities: [{ id: 'hero', kind: 'external', src: 'assets/game/entities/hero.png' }] });
    const r = await validateAssetReferences(dir, 'game-art-assets-entities');
    expect(r.valid).toBe(false);
    expect(r.missingFiles).toContain('assets/game/entities/hero.png');
    expect(buildAssetRetryMessage(r, 'game-art-assets-entities')).toMatch(/assets\/game/);
  });

  it('flags an over-ceiling inline entry with promote-to-external guidance (§1c)', async () => {
    write({ _meta: {}, sfx: [{ id: 'drone', kind: 'inline', format: 'oscillator', oscillator: { durationMs: 9000 } }] });
    const r = await validateAssetReferences(dir, 'game-art-assets-sfx');
    expect(r.valid).toBe(false);
    expect(r.inlineViolations.some(v => v.id === 'drone')).toBe(true);
    expect(buildAssetRetryMessage(r, 'game-art-assets-sfx')).toMatch(/kind:external/);
  });

  it('passes a clean inline-only catalog', async () => {
    write({ _meta: {}, entities: [{ id: 'tile', kind: 'inline', format: 'css', css: '.tile{width:8px}' }] });
    const r = await validateAssetReferences(dir, 'game-art-assets-entities');
    expect(r.valid).toBe(true);
  });
});

describe('WS2 §3D — game-art-source-dispatch selects the handoff partial', () => {
  let adapter: FilePromptAdapter;
  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
  });

  it('gameArtSource=handoff renders the handoff survey partial', async () => {
    const out = await adapter.render('jobs/code/base/injections/game-art-source-dispatch', { gameArtSource: 'handoff' });
    expect(out).toMatch(/GAME-ART SOURCE — HANDOFF/);
    expect(out).toMatch(/Survey-first|survey/i);
  });

  it('gameArtSource=ant renders the canonical partial (not handoff)', async () => {
    const out = await adapter.render('jobs/code/base/injections/game-art-source-dispatch', { gameArtSource: 'ant' });
    expect(out).toMatch(/GAME-ART SOURCE — ANT CANONICAL/);
    expect(out).not.toMatch(/GAME-ART SOURCE — HANDOFF/);
  });

  it('null gameArtSource falls back to the canonical partial', async () => {
    const out = await adapter.render('jobs/code/base/injections/game-art-source-dispatch', { gameArtSource: null });
    expect(out).toMatch(/GAME-ART SOURCE — ANT CANONICAL/);
  });
});
