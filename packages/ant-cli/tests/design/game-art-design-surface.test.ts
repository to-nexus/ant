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
