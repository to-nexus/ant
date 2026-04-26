/**
 * Content / Art Tier Variants Non-Stub (Phase 3 — Wave 2 regression)
 *
 * Wave 2 fills the universal genre / coreLoop / concept / perspective
 * variants. This test guards against silent stub regression — every
 * variant partial must carry a substantive body (≥ 600 chars of
 * markdown) and must keep its SBS gate's information payload by
 * mentioning its own variant name in the body.
 *
 * The threshold (≥ 600) was chosen so a Phase 1 stub (~100 chars)
 * cannot pass. Wave 2 partials run 1.5–4 KB; the threshold leaves
 * generous headroom for editorial trimming without falling back into
 * stub territory.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const TEMPLATES_ROOT = path.resolve(__dirname, '../src/core/prompt/templates');

const GENRE_VARIANTS = ['action', 'puzzle', 'platformer', 'shooter', 'rpg', 'strategy', 'casual'];
const CORELOOP_VARIANTS = ['collect', 'fight', 'build', 'explore', 'solve'];
const CONCEPT_VARIANTS = ['sfFantasy', 'darkFantasy', 'threeKingdoms', 'martialArts', 'modernCasual', 'pixelRetro'];
const PERSPECTIVE_VARIANTS = ['2d', '3d'];

const MIN_BODY_CHARS = 600;

interface VariantSpec {
  group: string;
  variant: string;
  file: string;
  // The variant name (or a known alias) MUST appear in the body so the
  // SBS gate's information payload is non-zero.
  vocabAliases: string[];
}

function spec(group: string, basePath: string, variant: string, aliases: string[] = []): VariantSpec {
  return {
    group,
    variant,
    file: path.join(TEMPLATES_ROOT, basePath, `${variant}.md`),
    vocabAliases: [variant, ...aliases],
  };
}

const VARIANT_SPECS: VariantSpec[] = [
  ...GENRE_VARIANTS.map(v => spec('gameContentTier.genre', 'basis/gameContentTier/genre', v)),
  ...CORELOOP_VARIANTS.map(v => spec('gameContentTier.coreLoop', 'basis/gameContentTier/coreLoop', v)),
  ...CONCEPT_VARIANTS.map(v => spec('gameArtTier.concept', 'basis/gameArtTier/concept', v, [
    // human-readable variant name aliases
    v === 'sfFantasy' ? 'SF Fantasy' :
    v === 'darkFantasy' ? 'Dark Fantasy' :
    v === 'threeKingdoms' ? 'Three Kingdoms' :
    v === 'martialArts' ? 'Martial Arts' :
    v === 'modernCasual' ? 'Modern Casual' :
    v === 'pixelRetro' ? 'Pixel Retro' : v,
  ])),
  ...PERSPECTIVE_VARIANTS.map(v => spec('gameArtTier.perspective', 'basis/gameArtTier/perspective', v)),
];

describe('Content / Art Tier Variants Non-Stub (Wave 2)', () => {
  it.each(VARIANT_SPECS)('$group/$variant.md is non-stub (≥ ' + MIN_BODY_CHARS + ' chars)', ({ file }) => {
    expect(fs.existsSync(file), `partial does not exist: ${path.relative(TEMPLATES_ROOT, file)}`).toBe(true);
    const src = fs.readFileSync(file, 'utf-8');
    expect(
      src.length,
      `${path.relative(TEMPLATES_ROOT, file)} is too short (likely a stub). Got ${src.length} chars; need ≥ ${MIN_BODY_CHARS}.`,
    ).toBeGreaterThanOrEqual(MIN_BODY_CHARS);
  });

  it.each(VARIANT_SPECS)('$group/$variant.md mentions its own variant name (SBS gate payload)', ({ file, vocabAliases }) => {
    const src = fs.readFileSync(file, 'utf-8');
    const matched = vocabAliases.filter(alias => {
      const re = new RegExp(`\\b${alias.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
      return re.test(src);
    });
    expect(
      matched.length,
      `${path.relative(TEMPLATES_ROOT, file)} must mention its own variant name (one of: ${vocabAliases.join(', ')}).`,
    ).toBeGreaterThan(0);
  });

  it('all genre / coreLoop / concept / perspective variants exist on disk', () => {
    for (const { file } of VARIANT_SPECS) {
      expect(fs.existsSync(file), `missing variant file: ${path.relative(TEMPLATES_ROOT, file)}`).toBe(true);
    }
  });
});

describe('Content / Art Tier Variant Cross-Pollution (Wave 2)', () => {
  // Each variant partial MUST stay inside its own SBS gate. Sibling
  // variant names must NOT appear in plain text (backtick-wrapped
  // citations are allowed — the partials reference siblings as code
  // spans when listing affinity / reference clusters).

  function plainText(src: string): string {
    return src
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`\n]*`/g, '');
  }

  function siblingVocab(group: VariantSpec[], current: string): string[] {
    return group
      .filter(s => s.variant !== current)
      .flatMap(s => s.vocabAliases)
      // exclude generic English words that happen to be aliases of nothing
      .filter(w => w.length >= 3);
  }

  function splitGroup(prefix: string): VariantSpec[] {
    return VARIANT_SPECS.filter(s => s.group === prefix);
  }

  const groups = [
    'gameContentTier.genre',
    'gameContentTier.coreLoop',
    'gameArtTier.concept',
    'gameArtTier.perspective',
  ];

  for (const groupKey of groups) {
    const groupSpecs = splitGroup(groupKey);
    for (const target of groupSpecs) {
      it(`${groupKey}/${target.variant}.md plain text must NOT mention sibling variant names`, () => {
        const src = fs.readFileSync(target.file, 'utf-8');
        const plain = plainText(src);
        const siblings = siblingVocab(groupSpecs, target.variant);
        const hits: string[] = [];
        for (const w of siblings) {
          // word-boundary, case-insensitive
          const re = new RegExp(`\\b${w.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
          if (re.test(plain)) hits.push(w);
        }
        expect(
          hits,
          `${path.relative(TEMPLATES_ROOT, target.file)} plain text contains sibling variant vocabulary (move to backticks if quoting): ${hits.join(', ')}`,
        ).toEqual([]);
      });
    }
  }
});
