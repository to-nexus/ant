/**
 * Game Art Tier Registry ↔ Template Sync (Phase 2, F-5 — D12-revised)
 *
 * Mirrors the visualTier / techTier registry parity tests:
 *   1. Every variant declared in the registry has a corresponding
 *      `.md` template file at the path returned by GAME_ART_TIER_TEMPLATE_PATHS.
 *   2. No orphan template files exist in `templates/basis/gameArtTier/**`.
 *
 * Phase 2 ships variants for `concept` / `perspective` plus stubs for the
 * 5 Phase 4 axes (entityCatalog / motionPattern / particleProfile /
 * projectilePolicy / audioProfile). The test treats both as first-class
 * variants — Phase 4 fills bodies but the partial paths are stable now.
 *
 * Rename history (D12-revised, Phase 2): the previous `art-tier-registry.test.ts`
 * was renamed and the registry references switched from the deprecated
 * `ART_*` names to the canonical `GAME_ART_*` names.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  GAME_ART_CONCEPT_VARIANTS,
  GAME_ART_PERSPECTIVE_VARIANTS,
  GAME_ART_ENTITY_CATALOG_VARIANTS,
  GAME_ART_MOTION_PATTERN_VARIANTS,
  GAME_ART_PARTICLE_PROFILE_VARIANTS,
  GAME_ART_PROJECTILE_POLICY_VARIANTS,
  GAME_ART_AUDIO_PROFILE_VARIANTS,
  GAME_ART_TIER_TEMPLATE_PATHS,
  GAME_ART_TIER_AXIS_KEYS,
} from '@ant/shared';

const TEMPLATES_ROOT = path.resolve(__dirname, '../src/core/prompt/templates');

function templateExists(templatePath: string): boolean {
  return fs.existsSync(path.join(TEMPLATES_ROOT, `${templatePath}.md`));
}

const VARIANT_MAP: Record<string, readonly string[]> = {
  concept: GAME_ART_CONCEPT_VARIANTS,
  perspective: GAME_ART_PERSPECTIVE_VARIANTS,
  entityCatalog: GAME_ART_ENTITY_CATALOG_VARIANTS,
  motionPattern: GAME_ART_MOTION_PATTERN_VARIANTS,
  particleProfile: GAME_ART_PARTICLE_PROFILE_VARIANTS,
  projectilePolicy: GAME_ART_PROJECTILE_POLICY_VARIANTS,
  audioProfile: GAME_ART_AUDIO_PROFILE_VARIANTS,
};

describe('GameArtTier: Registry → Template files exist', () => {
  it('shared preamble exists', () => {
    expect(templateExists(GAME_ART_TIER_TEMPLATE_PATHS.preamble())).toBe(true);
  });

  for (const axis of GAME_ART_TIER_AXIS_KEYS) {
    describe(`axis: ${axis}`, () => {
      const variants = VARIANT_MAP[axis];
      const pathFn = GAME_ART_TIER_TEMPLATE_PATHS[axis as keyof typeof GAME_ART_TIER_TEMPLATE_PATHS];
      it.each([...variants])(`variant "%s" has template file`, (variant) => {
        expect(templateExists((pathFn as (v: string) => string)(variant))).toBe(true);
      });
    });
  }
});

describe('GameArtTier: Template files → Registry (no orphans)', () => {
  const registryPaths = new Set<string>([
    GAME_ART_TIER_TEMPLATE_PATHS.preamble(),
  ]);
  for (const axis of GAME_ART_TIER_AXIS_KEYS) {
    const pathFn = GAME_ART_TIER_TEMPLATE_PATHS[axis as keyof typeof GAME_ART_TIER_TEMPLATE_PATHS];
    for (const v of VARIANT_MAP[axis]) {
      registryPaths.add((pathFn as (v: string) => string)(v));
    }
  }

  it('every basis/gameArtTier/ template file is in registry', () => {
    const dir = path.join(TEMPLATES_ROOT, 'basis/gameArtTier');
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
    if (entry.isDirectory()) {
      results.push(...collectMdFiles(full));
    } else if (entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}
