/**
 * Art Tier Registry ↔ Template Sync (Phase 1, F-5)
 *
 * Mirrors the visualTier / techTier registry parity tests:
 *   1. Every variant declared in the registry has a corresponding
 *      `.md` template file at the path returned by ART_TIER_TEMPLATE_PATHS.
 *   2. No orphan template files exist in `templates/basis/artTier/**`.
 *
 * Phase 1 ships variants for `concept` / `perspective` plus stubs for the
 * 5 Phase 3 axes (entityCatalog / motionPattern / particleProfile /
 * projectilePolicy / audioProfile). The test treats both as first-class
 * variants — Phase 3 fills bodies but the partial paths are stable now.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ART_CONCEPT_VARIANTS,
  ART_PERSPECTIVE_VARIANTS,
  ART_ENTITY_CATALOG_VARIANTS,
  ART_MOTION_PATTERN_VARIANTS,
  ART_PARTICLE_PROFILE_VARIANTS,
  ART_PROJECTILE_POLICY_VARIANTS,
  ART_AUDIO_PROFILE_VARIANTS,
  ART_TIER_TEMPLATE_PATHS,
  ART_TIER_AXIS_KEYS,
} from '@ant/shared';

const TEMPLATES_ROOT = path.resolve(__dirname, '../src/core/prompt/templates');

function templateExists(templatePath: string): boolean {
  return fs.existsSync(path.join(TEMPLATES_ROOT, `${templatePath}.md`));
}

const VARIANT_MAP: Record<string, readonly string[]> = {
  concept: ART_CONCEPT_VARIANTS,
  perspective: ART_PERSPECTIVE_VARIANTS,
  entityCatalog: ART_ENTITY_CATALOG_VARIANTS,
  motionPattern: ART_MOTION_PATTERN_VARIANTS,
  particleProfile: ART_PARTICLE_PROFILE_VARIANTS,
  projectilePolicy: ART_PROJECTILE_POLICY_VARIANTS,
  audioProfile: ART_AUDIO_PROFILE_VARIANTS,
};

describe('ArtTier: Registry → Template files exist', () => {
  it('shared preamble exists', () => {
    expect(templateExists(ART_TIER_TEMPLATE_PATHS.preamble())).toBe(true);
  });

  for (const axis of ART_TIER_AXIS_KEYS) {
    describe(`axis: ${axis}`, () => {
      const variants = VARIANT_MAP[axis];
      const pathFn = ART_TIER_TEMPLATE_PATHS[axis as keyof typeof ART_TIER_TEMPLATE_PATHS];
      it.each([...variants])(`variant "%s" has template file`, (variant) => {
        expect(templateExists((pathFn as (v: string) => string)(variant))).toBe(true);
      });
    });
  }
});

describe('ArtTier: Template files → Registry (no orphans)', () => {
  const registryPaths = new Set<string>([
    ART_TIER_TEMPLATE_PATHS.preamble(),
  ]);
  for (const axis of ART_TIER_AXIS_KEYS) {
    const pathFn = ART_TIER_TEMPLATE_PATHS[axis as keyof typeof ART_TIER_TEMPLATE_PATHS];
    for (const v of VARIANT_MAP[axis]) {
      registryPaths.add((pathFn as (v: string) => string)(v));
    }
  }

  it('every basis/artTier/ template file is in registry', () => {
    const dir = path.join(TEMPLATES_ROOT, 'basis/artTier');
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
