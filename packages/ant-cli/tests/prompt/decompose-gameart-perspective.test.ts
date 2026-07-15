/**
 * Regression guard: explicit gameArtTier.perspective (3d) must survive the code
 * decompose node.
 *
 * Two compounding defects previously flipped a user-selected `perspective=3d`
 * to `2d` in a code job:
 *   1. The decompose prompt hard-coded the perspective candidates as `2d` only
 *      ("3D deferred to Phase 5+"), so the LLM re-emitted 2d.
 *   2. STEP 6.65 spread the LLM emit / default-fill (perspective='2d') OVER the
 *      carried explicit basis, with no explicit-authority guard.
 *
 * This locks: (a) the rendered prompt lists `3d` among the perspective
 * candidates, and (b) `applyExplicitGameArtTierOverrides` keeps explicit axes
 * authoritative over both an LLM emit AND the default-fill path.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { applyExplicitGameArtTierOverrides, type GameArtTier } from '@ant/shared';
import {
  FilePromptAdapter,
  initPartials,
} from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATES_DIR = join(__dirname, '../../src/core/prompt/templates');

describe('decompose gameArtTier perspective explicit-authority', () => {
  let adapter: FilePromptAdapter;

  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
  });

  it('rendered decompose base lists 3d among perspective candidates (no Phase-5 defer claim)', async () => {
    const output = await adapter.render(
      'jobs/code/nodes/decompose/variants/default/base',
      {
        directive: 'Build a 3D arcade game',
        gameArtTierActive: true,
        gameArtConceptCandidates: '`flatMinimal`, `pixelRetro`, `neonArcade`',
        // Mirrors decompose/index.ts:469-471 serialization.
        gameArtPerspectiveCandidates: '`2d`, `3d`',
      },
    );

    expect(output).toContain('`3d`');
    // Stale D39 claim must be gone — 3d is an active registry variant.
    expect(output).not.toContain('3D deferred to Phase 5+');
  });

  it('explicit perspective=3d wins over an LLM-emitted 2d', () => {
    const carried: GameArtTier = { concept: 'neonArcade', perspective: '3d' };
    const explicit: GameArtTier = { concept: 'neonArcade', perspective: '3d' };
    // LLM re-emitted the whole tier with perspective=2d.
    const emitted: GameArtTier = {
      concept: 'neonArcade',
      perspective: '2d',
      entityCatalog: 'standard',
    };

    const merged = applyExplicitGameArtTierOverrides(carried, emitted, explicit);

    expect(merged.perspective).toBe('3d');
    // Axes the explicit basis lacks are still filled from the emit.
    expect(merged.entityCatalog).toBe('standard');
  });

  it('explicit perspective=3d wins over the default-fill (missing tag → 2d)', () => {
    const carried: GameArtTier = { perspective: '3d' };
    const explicit: GameArtTier = { perspective: '3d' };
    // default-on-retry-exhaustion object (DecisionTagRegistry) — perspective 2d.
    const defaultFill: GameArtTier = {
      concept: 'flatMinimal',
      perspective: '2d',
      entityCatalog: 'standard',
      motionPattern: 'subtle',
      particleProfile: 'light',
      projectilePolicy: 'simple',
      audioProfile: 'procedural',
    };

    const merged = applyExplicitGameArtTierOverrides(carried, defaultFill, explicit);

    expect(merged.perspective).toBe('3d');
    expect(merged.concept).toBe('flatMinimal');
  });

  it('infer path (no explicit basis) leaves the emit in control', () => {
    const emitted: GameArtTier = { concept: 'pixelRetro', perspective: '2d' };
    const merged = applyExplicitGameArtTierOverrides(undefined, emitted, undefined);
    expect(merged.perspective).toBe('2d');
    expect(merged.concept).toBe('pixelRetro');
  });
});
