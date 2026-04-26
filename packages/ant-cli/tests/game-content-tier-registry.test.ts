/**
 * Game Content Tier Registry ↔ Template Sync (Phase 1)
 *
 * Mirrors the gameArtTier / visualTier parity tests for the gameContentTier
 * registry. Phase 1 ships full variant lists for genre × 7 + coreLoop × 5
 * with Phase 1 stub bodies (Phase 2 fills content).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  GAME_GENRE_VARIANTS,
  GAME_CORE_LOOP_VARIANTS,
  GAME_CONTENT_TIER_TEMPLATE_PATHS,
} from '@ant/shared';

const TEMPLATES_ROOT = path.resolve(__dirname, '../src/core/prompt/templates');

function templateExists(p: string): boolean {
  return fs.existsSync(path.join(TEMPLATES_ROOT, `${p}.md`));
}

describe('GameContentTier: Registry → Template files exist', () => {
  it('shared preamble exists', () => {
    expect(templateExists(GAME_CONTENT_TIER_TEMPLATE_PATHS.preamble())).toBe(true);
  });

  it.each([...GAME_GENRE_VARIANTS])('genre "%s" has template file', (g) => {
    expect(templateExists(GAME_CONTENT_TIER_TEMPLATE_PATHS.genre(g))).toBe(true);
  });

  it.each([...GAME_CORE_LOOP_VARIANTS])('coreLoop "%s" has template file', (c) => {
    expect(templateExists(GAME_CONTENT_TIER_TEMPLATE_PATHS.coreLoop(c))).toBe(true);
  });
});

describe('GameContentTier: Template files → Registry (no orphans)', () => {
  const registryPaths = new Set<string>([GAME_CONTENT_TIER_TEMPLATE_PATHS.preamble()]);
  for (const g of GAME_GENRE_VARIANTS) {
    registryPaths.add(GAME_CONTENT_TIER_TEMPLATE_PATHS.genre(g));
  }
  for (const c of GAME_CORE_LOOP_VARIANTS) {
    registryPaths.add(GAME_CONTENT_TIER_TEMPLATE_PATHS.coreLoop(c));
  }

  it('every basis/gameContentTier template file is in registry', () => {
    const dir = path.join(TEMPLATES_ROOT, 'basis/gameContentTier');
    const files = collectMdFiles(dir);
    for (const file of files) {
      const rel = path.relative(TEMPLATES_ROOT, file).replace(/\.md$/, '').replace(/\\/g, '/');
      const basename = path.basename(file, '.md');
      if (basename.startsWith('_') && basename !== '_preamble') continue;
      expect(registryPaths.has(rel)).toBe(true);
    }
  });
});

function collectMdFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...collectMdFiles(full));
    else if (entry.name.endsWith('.md')) results.push(full);
  }
  return results;
}
