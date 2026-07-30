/**
 * I7-revised — Domain-Surface Boundary (Phase 2 — D18 / D21 / D28)
 *
 * UI design (gen-ui-* / rev-ui) is service-domain-only and game-art design
 * (gen-game-art-* / rev-game-art) is game-domain-only — D28 vertical split.
 * The two surfaces remain orthogonal at the prompt level:
 *
 *   - UI surface vocabulary: `visualLanguage`, `surfaceSystem`,
 *     `spatialSystem` (and their layer keywords).
 *   - Game-art surface vocabulary: `sprite`, `character`, `oscillator`,
 *     `particle`, `projectile`.
 *
 * Cross-pollution is forbidden — UI design prompts must NOT speak about
 * sprites / oscillators, and game-art prompts must NOT speak about
 * `visualLanguage` / `surfaceSystem` / `spatialSystem`. Phase 2 stub
 * bodies; tighter Phase 3 / Phase 4 fills inherit this gate.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const TEMPLATES_ROOT = path.resolve(__dirname, '../../src/core/prompt/templates');

// Forbidden inside UI design prompts (game-art surface keywords).
const UI_FORBIDDEN = /\b(sprite\s+(sheet|tween|animation)|sprite-sheet|<oscillator|OscillatorNode\b|particle\s+system|projectile\s+(spawn|policy))\b/i;

// Forbidden inside Game-Art design prompts (UI surface keywords).
// Negative lookbehind / lookahead skip backtick-quoted boundary mentions
// like ``\`visualLanguage\` is NOT in scope here`` — those are explicit
// boundary disclaimers, not cross-pollution.
const ART_FORBIDDEN = /(?<!`)\b(visualLanguage|surfaceSystem|spatialSystem|interactionGrammar|componentSemantics|visualHierarchy)\b(?!`)/;

function* walkMd(dirRel: string): Generator<string> {
  const dirAbs = path.join(TEMPLATES_ROOT, dirRel);
  if (!fs.existsSync(dirAbs)) return;
  for (const e of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    const childAbs = path.join(dirAbs, e.name);
    if (e.isDirectory()) {
      yield* walkMd(path.relative(TEMPLATES_ROOT, childAbs));
    } else if (e.isFile() && e.name.endsWith('.md')) {
      yield path.relative(TEMPLATES_ROOT, childAbs);
    }
  }
}

function readMd(rel: string): string {
  return fs.readFileSync(path.join(TEMPLATES_ROOT, rel), 'utf-8');
}

describe('I7-revised — Domain-Surface Boundary', () => {
  // UI design templates (decompose / execute) live under specific dirs.
  it('UI design decompose / execute templates avoid game-art keywords', () => {
    const dirs = [
      'jobs/design/nodes/decompose/variants/ui-design-by-figma',
      'jobs/design/nodes/decompose/variants/ui-design-by-desc',
      'jobs/design/nodes/execute/variants/ui-design-by-desc',
    ];
    const offenders: Array<{ file: string; match: string }> = [];
    for (const dir of dirs) {
      for (const rel of walkMd(dir)) {
        const body = readMd(rel);
        const m = body.match(UI_FORBIDDEN);
        if (m) offenders.push({ file: rel, match: m[0] });
      }
    }
    expect(offenders).toEqual([]);
  });

  // Game-Art design templates avoid UI surface vocabulary.
  it('game-art design decompose / execute templates avoid UI surface keywords', () => {
    const dirs = [
      'jobs/design/nodes/decompose/variants/game-art-design-by-figma',
      'jobs/design/nodes/decompose/variants/game-art-design-by-desc',
      'jobs/design/nodes/execute/variants/game-art-by-desc',
      'jobs/design/nodes/execute/variants/game-art-by-figma',
    ];
    const offenders: Array<{ file: string; match: string }> = [];
    for (const dir of dirs) {
      for (const rel of walkMd(dir)) {
        const body = readMd(rel);
        const m = body.match(ART_FORBIDDEN);
        if (m) offenders.push({ file: rel, match: m[0] });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('game-art-tier basis preamble (jobs/design) declares the css-only scope (D21)', () => {
    const rel = 'jobs/design/basis/gameArtTier/_preamble.md';
    const body = readMd(rel);
    expect(body).toMatch(/css-only|css\s+only/i);
    expect(body).toMatch(/inline/i);
    expect(body).toMatch(/external/i);
  });
});

describe('model-asset consumption legalization (perspective=3d — consumption ≠ authoring)', () => {
  it('3d perspective consumes attached/cataloged models and never downgrades to primitives', () => {
    const body = readMd('basis/gameArtTier/perspective/3d.md');
    expect(body).toMatch(/gltf/i);
    expect(body).toMatch(/NEVER substitute a\s+primitive/i);
    // The blanket consumption prohibition must stay dead.
    expect(body).not.toMatch(/Do NOT reach for a model loader/);
    expect(body).not.toMatch(/no imported model assets/);
  });

  it('design preamble carries the models/ category (tree + canonical menu)', () => {
    const body = readMd('jobs/design/basis/gameArtTier/_preamble.md');
    expect(body).toMatch(/models\/\s+# 3D model meshes/);
    expect(body).toMatch(/`models`/);
  });

  it('assets guide gates models on perspective=3d and admits glb/gltf external format', () => {
    const body = readMd('jobs/design/nodes/execute/injections/game-art-assets-guide-by-desc.md');
    expect(body).toMatch(/\| `models`\s+\| `perspective === '3d'`/);
    expect(body).toMatch(/"glb" \| "gltf"/);
    expect(body).toMatch(/user-placed real file is always consumable/i);
  });

  it('code preamble enumerates the 3D model preload as a legal canvas-side category', () => {
    const body = readMd('jobs/code/basis/gameArtTier/_preamble.md');
    expect(body).toMatch(/six legal categories/);
    expect(body).toMatch(/\*\*3D model preload\*\*/);
    expect(body).toMatch(/PRESENT, not silent/);
    expect(body).toMatch(/`models` \|/); // §3.2 loading table row
  });
});

// game-art-design is the game-domain positional peer of design-ui (D28): it has
// its own execute builder + variant templates instead of falling through to the
// system-design path. These lock the wiring so a game-art design job never
// re-derives service-domain output dirs (the `bronze-fishing-chess` RCA).
describe('game-art execute path parity with design-ui (D28)', () => {
  for (const suffix of ['by-desc', 'by-figma'] as const) {
    it(`game-art-${suffix} variant dispatches the game-art guides + targets visual/game-art/ant`, () => {
      const base = readMd(`jobs/design/nodes/execute/variants/game-art-${suffix}/base.md`);
      for (const kind of ['tokens', 'assets', 'spec']) {
        expect(base).toContain(`jobs/design/nodes/execute/injections/game-art-${kind}-guide-${suffix}`);
      }
      const rules = readMd(`jobs/design/nodes/execute/variants/game-art-${suffix}/rules.md`);
      expect(rules).toContain('visual/game-art/ant/');
      // Must NOT write into the service-domain UI tree or the codebase tree.
      expect(rules).not.toContain('visual/ui/ant/');
    });
  }

  it('execute node routes design-game-art to the dedicated game-art builder', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/agents/architect/graph/design/nodes/execute/index.ts'),
      'utf-8',
    );
    expect(src).toContain("intentGroup === 'design-game-art'");
    expect(src).toContain('buildGameArtMessages(state)');
  });

  it('learn node scans visual/game-art/ant for a game-art design job', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/agents/architect/graph/design/nodes/learn/index.ts'),
      'utf-8',
    );
    expect(src).toContain("intentGroup === 'design-game-art'");
    expect(src).toContain('ARTIFACT_PREFIX.GAME_ART_ANT');
    // The old service-only error string must be gone (it pointed game jobs at visual/ui/ant).
    expect(src).not.toContain('No design files found under architecture/{system,spec}/ or visual/ui/ant/');
  });
});
