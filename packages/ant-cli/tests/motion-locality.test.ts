/**
 * I5 — Motion Locality (Phase 1, F-6)
 *
 * Motion vocabulary belongs to two distinct surfaces:
 *
 *   - `interactionGrammar` (visualTier layer 4) — UI/HUD page transitions,
 *     hover, focus, page entrance.
 *   - `artTier.motionPattern` / `particleProfile` / `projectilePolicy` —
 *     engine-internal sprite tween / animation / camera shake / particles
 *     / projectiles.
 *
 * Cross-pollution (sprite/projectile/particle keywords inside
 * interactionGrammar partials, or page-transition/hover keywords inside
 * artTier motion partials) is forbidden so the two surfaces stay
 * non-overlapping. Phase 1 partial bodies are stub one-liners; this test
 * locks the keyword vocabulary in for the moment Phase 2/3 fills the
 * bodies.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const TEMPLATES_ROOT = path.resolve(__dirname, '../src/core/prompt/templates');

const ART_MOTION_FORBIDDEN = /\b(page\s*transition|page\s*entrance|hover\s+state|focus\s+ring|modal\s+enter|drawer\s+slide)\b/i;
const UI_MOTION_FORBIDDEN = /\b(sprite\s+tween|sprite\s+animation|camera\s+shake|particle\s+system|projectile|bullet\s+spawn|squash[\s-]?stretch)\b/i;

function readMd(relPath: string): string {
  const file = path.join(TEMPLATES_ROOT, relPath);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
}

function* walkArtTierMotionFiles(): Generator<string> {
  const root = path.join(TEMPLATES_ROOT, 'basis/artTier');
  for (const axis of ['motionPattern', 'particleProfile', 'projectilePolicy']) {
    const dir = path.join(root, axis);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.md')) yield path.relative(TEMPLATES_ROOT, path.join(dir, f));
    }
  }
}

function* walkInteractionGrammarFiles(): Generator<string> {
  const dir = path.join(TEMPLATES_ROOT, 'basis/visualTier/interactionGrammar');
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.md')) yield path.relative(TEMPLATES_ROOT, path.join(dir, f));
  }
}

describe('I5 — Motion Locality', () => {
  it('artTier motion partials must not name UI-motion vocabulary', () => {
    const offenders: Array<{ file: string; match: string }> = [];
    for (const rel of walkArtTierMotionFiles()) {
      const src = readMd(rel);
      const m = src.match(ART_MOTION_FORBIDDEN);
      if (m) offenders.push({ file: rel, match: m[0] });
    }
    if (offenders.length > 0) {
      throw new Error(
        `art motion partials contain UI motion vocabulary:\n${offenders.map(o => `  ${o.file}: ${o.match}`).join('\n')}`,
      );
    }
    expect(offenders).toHaveLength(0);
  });

  it('visualTier interactionGrammar partials must not name engine-art vocabulary', () => {
    const offenders: Array<{ file: string; match: string }> = [];
    for (const rel of walkInteractionGrammarFiles()) {
      const src = readMd(rel);
      const m = src.match(UI_MOTION_FORBIDDEN);
      if (m) offenders.push({ file: rel, match: m[0] });
    }
    if (offenders.length > 0) {
      throw new Error(
        `interactionGrammar partials contain engine-art vocabulary:\n${offenders.map(o => `  ${o.file}: ${o.match}`).join('\n')}`,
      );
    }
    expect(offenders).toHaveLength(0);
  });
});
