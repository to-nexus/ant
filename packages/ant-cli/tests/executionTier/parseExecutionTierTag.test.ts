/**
 * parseExecutionTierTag / coerceExecutionTier — shared LLM contract
 * covering Phase B Tier Entry Nodes (code/design Decompose, plan/visual
 * Detect).
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import {
  parseExecutionTierTag,
  coerceExecutionTier,
  validateExecutionTier,
  ExecutionTierViolation,
  buildExecutionTierViolationFraming,
} from '../../src/core/executionTier';
import { ArtifactPoolView } from '../../src/core/artifact/ArtifactPipeline';
import { ExecutionTierId } from '@ant/shared';
import type { ResolvedArtifact } from '@ant/shared';

function poolWith(...paths: Array<{ path: string; role: 'ref' | 'context' }>): ArtifactPoolView {
  const artifacts: ResolvedArtifact[] = paths.map(({ path, role }) => ({
    path,
    role,
    content: 'stub',
  }));
  return new ArtifactPoolView(artifacts);
}

beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('parseExecutionTierTag', () => {
  it.each([
    ['<executionTier>0</executionTier>', ExecutionTierId.Reflex],
    ['<executionTier>1</executionTier>', ExecutionTierId.OneShot],
    ['<executionTier>2</executionTier>', ExecutionTierId.Exploratory],
    ['<executionTier>3</executionTier>', ExecutionTierId.Task],
    ['<executionTier>4</executionTier>', ExecutionTierId.RefsGrounded],
  ])('parses %s → %d', (raw, expected) => {
    expect(parseExecutionTierTag(raw)).toBe(expected);
  });

  it('tolerates whitespace / leading content', () => {
    const raw = 'Some prose...\n<executionTier>\n  3\n</executionTier>\nand more prose';
    expect(parseExecutionTierTag(raw)).toBe(ExecutionTierId.Task);
  });

  it('is case-insensitive on tag name', () => {
    expect(parseExecutionTierTag('<ExecutionTier>2</ExecutionTier>')).toBe(
      ExecutionTierId.Exploratory,
    );
  });

  it('returns undefined when tag is missing', () => {
    expect(parseExecutionTierTag('just prose')).toBeUndefined();
    expect(parseExecutionTierTag('')).toBeUndefined();
    expect(parseExecutionTierTag(undefined)).toBeUndefined();
  });

  it('returns undefined for out-of-range or non-integer tiers', () => {
    expect(parseExecutionTierTag('<executionTier>5</executionTier>')).toBeUndefined();
    expect(parseExecutionTierTag('<executionTier>-1</executionTier>')).toBeUndefined();
    expect(parseExecutionTierTag('<executionTier>2.5</executionTier>')).toBeUndefined();
    expect(parseExecutionTierTag('<executionTier>task</executionTier>')).toBeUndefined();
    expect(parseExecutionTierTag('<executionTier></executionTier>')).toBeUndefined();
  });
});

describe('coerceExecutionTier', () => {
  it('passes through a valid tier', () => {
    expect(coerceExecutionTier(ExecutionTierId.RefsGrounded, 'Test')).toBe(
      ExecutionTierId.RefsGrounded,
    );
    expect(coerceExecutionTier(ExecutionTierId.Reflex, 'Test')).toBe(
      ExecutionTierId.Reflex,
    );
  });

  it('degrades undefined to Tier 0 Reflex (hard default)', () => {
    expect(coerceExecutionTier(undefined, 'Test')).toBe(ExecutionTierId.Reflex);
  });
});

describe('validateExecutionTier', () => {
  it('passes through a valid tier for any mode', () => {
    for (const mode of ['explain', 'generate', 'refactor'] as const) {
      expect(
        validateExecutionTier(ExecutionTierId.OneShot, { mode, nodeLabel: 'Test' }),
      ).toBe(ExecutionTierId.OneShot);
      expect(
        validateExecutionTier(ExecutionTierId.Task, { mode, nodeLabel: 'Test' }),
      ).toBe(ExecutionTierId.Task);
    }
  });

  it('allows Tier 0 for explain mode', () => {
    expect(
      validateExecutionTier(ExecutionTierId.Reflex, { mode: 'explain', nodeLabel: 'Test' }),
    ).toBe(ExecutionTierId.Reflex);
  });

  it('throws MISSING_TAG when tier is undefined', () => {
    const ex = () =>
      validateExecutionTier(undefined, { mode: 'generate', nodeLabel: 'Decompose' });
    expect(ex).toThrow(ExecutionTierViolation);
    try {
      ex();
    } catch (e) {
      expect(e).toBeInstanceOf(ExecutionTierViolation);
      expect((e as ExecutionTierViolation).code).toBe('MISSING_TAG');
      expect((e as ExecutionTierViolation).nodeLabel).toBe('Decompose');
      expect((e as ExecutionTierViolation).mode).toBe('generate');
    }
  });

  it('throws FORBIDDEN_TIER_FOR_MODE when tier=0 for generate mode', () => {
    try {
      validateExecutionTier(ExecutionTierId.Reflex, {
        mode: 'generate',
        nodeLabel: 'Decompose',
      });
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ExecutionTierViolation);
      expect((e as ExecutionTierViolation).code).toBe('FORBIDDEN_TIER_FOR_MODE');
      expect((e as ExecutionTierViolation).mode).toBe('generate');
      expect((e as ExecutionTierViolation).observedTier).toBe(ExecutionTierId.Reflex);
    }
  });

  it('throws FORBIDDEN_TIER_FOR_MODE when tier=0 for refactor mode', () => {
    try {
      validateExecutionTier(ExecutionTierId.Reflex, {
        mode: 'refactor',
        nodeLabel: 'Decompose',
      });
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as ExecutionTierViolation).code).toBe('FORBIDDEN_TIER_FOR_MODE');
      expect((e as ExecutionTierViolation).mode).toBe('refactor');
    }
  });

  it('MISSING_TAG precedence wins over mode — undefined throws MISSING_TAG even for forbidden mode', () => {
    try {
      validateExecutionTier(undefined, { mode: 'refactor', nodeLabel: 'Decompose' });
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as ExecutionTierViolation).code).toBe('MISSING_TAG');
    }
  });

  describe('design-ref grounding (DESIGN_REF_REQUIRES_TIER4)', () => {
    it('throws DESIGN_REF_REQUIRES_TIER4 when generate mode + spec ref + tier=2', () => {
      const pool = poolWith({ path: 'architecture/spec/spec-feature.md', role: 'ref' });
      try {
        validateExecutionTier(ExecutionTierId.Exploratory, {
          mode: 'generate',
          nodeLabel: 'Decompose',
          pool,
        });
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ExecutionTierViolation);
        expect((e as ExecutionTierViolation).code).toBe('DESIGN_REF_REQUIRES_TIER4');
        expect((e as ExecutionTierViolation).mode).toBe('generate');
        expect((e as ExecutionTierViolation).observedTier).toBe(ExecutionTierId.Exploratory);
      }
    });

    it('throws DESIGN_REF_REQUIRES_TIER4 for refactor mode + system-design ref + tier=3', () => {
      const pool = poolWith({ path: 'architecture/system/be-system-main.md', role: 'ref' });
      try {
        validateExecutionTier(ExecutionTierId.Task, {
          mode: 'refactor',
          nodeLabel: 'Decompose',
          pool,
        });
        expect.fail('should have thrown');
      } catch (e) {
        expect((e as ExecutionTierViolation).code).toBe('DESIGN_REF_REQUIRES_TIER4');
      }
    });

    it('throws DESIGN_REF_REQUIRES_TIER4 for ui ref (under ui/ant)', () => {
      const pool = poolWith({ path: 'visual/ui/ant/ui-spec.json', role: 'ref' });
      try {
        validateExecutionTier(ExecutionTierId.OneShot, {
          mode: 'generate',
          nodeLabel: 'Decompose',
          pool,
        });
        expect.fail('should have thrown');
      } catch (e) {
        expect((e as ExecutionTierViolation).code).toBe('DESIGN_REF_REQUIRES_TIER4');
      }
    });

    it('throws DESIGN_REF_REQUIRES_TIER4 for game-art ref', () => {
      const pool = poolWith({ path: 'visual/game-art/ant/game-art-spec.json', role: 'ref' });
      try {
        validateExecutionTier(ExecutionTierId.Task, {
          mode: 'refactor',
          nodeLabel: 'Decompose',
          pool,
        });
        expect.fail('should have thrown');
      } catch (e) {
        expect((e as ExecutionTierViolation).code).toBe('DESIGN_REF_REQUIRES_TIER4');
      }
    });

    it('passes through Tier 4 when design ref is present (no violation)', () => {
      const pool = poolWith({ path: 'architecture/spec/spec-feature.md', role: 'ref' });
      expect(
        validateExecutionTier(ExecutionTierId.RefsGrounded, {
          mode: 'generate',
          nodeLabel: 'Decompose',
          pool,
        }),
      ).toBe(ExecutionTierId.RefsGrounded);
    });

    it('does NOT throw for design CONTEXT only (role=context, not ref)', () => {
      const pool = poolWith({ path: 'architecture/spec/spec-feature.md', role: 'context' });
      expect(
        validateExecutionTier(ExecutionTierId.Task, {
          mode: 'generate',
          nodeLabel: 'Decompose',
          pool,
        }),
      ).toBe(ExecutionTierId.Task);
    });

    it('does NOT throw for explain mode even with design ref', () => {
      const pool = poolWith({ path: 'architecture/spec/spec-feature.md', role: 'ref' });
      expect(
        validateExecutionTier(ExecutionTierId.Task, {
          mode: 'explain',
          nodeLabel: 'Decompose',
          pool,
        }),
      ).toBe(ExecutionTierId.Task);
    });

    it('does NOT throw when pool is omitted (legacy call sites)', () => {
      expect(
        validateExecutionTier(ExecutionTierId.Task, {
          mode: 'generate',
          nodeLabel: 'Decompose',
        }),
      ).toBe(ExecutionTierId.Task);
    });

    it('does NOT throw when pool has no design refs', () => {
      const pool = poolWith({ path: 'plan/prd.md', role: 'ref' });
      expect(
        validateExecutionTier(ExecutionTierId.Task, {
          mode: 'generate',
          nodeLabel: 'Decompose',
          pool,
        }),
      ).toBe(ExecutionTierId.Task);
    });

    it('precedence — MISSING_TAG still wins over DESIGN_REF_REQUIRES_TIER4', () => {
      const pool = poolWith({ path: 'architecture/spec/spec-feature.md', role: 'ref' });
      try {
        validateExecutionTier(undefined, {
          mode: 'generate',
          nodeLabel: 'Decompose',
          pool,
        });
        expect.fail('should have thrown');
      } catch (e) {
        expect((e as ExecutionTierViolation).code).toBe('MISSING_TAG');
      }
    });

    it('precedence — FORBIDDEN_TIER_FOR_MODE wins over DESIGN_REF_REQUIRES_TIER4', () => {
      const pool = poolWith({ path: 'architecture/spec/spec-feature.md', role: 'ref' });
      try {
        validateExecutionTier(ExecutionTierId.Reflex, {
          mode: 'generate',
          nodeLabel: 'Decompose',
          pool,
        });
        expect.fail('should have thrown');
      } catch (e) {
        expect((e as ExecutionTierViolation).code).toBe('FORBIDDEN_TIER_FOR_MODE');
      }
    });
  });
});

describe('buildExecutionTierViolationFraming', () => {
  it('produces a MISSING_TAG-specific retry message', () => {
    const v = new ExecutionTierViolation('MISSING_TAG', {
      nodeLabel: 'Decompose',
      mode: 'refactor',
    });
    const framing = buildExecutionTierViolationFraming(v);
    expect(framing).toContain('omitted');
    expect(framing).toContain('<executionTier>');
    expect(framing).toContain('EXACTLY ONE');
  });

  it('produces a FORBIDDEN_TIER-specific retry message with mode', () => {
    const v = new ExecutionTierViolation('FORBIDDEN_TIER_FOR_MODE', {
      nodeLabel: 'Decompose',
      mode: 'refactor',
      observedTier: ExecutionTierId.Reflex,
    });
    const framing = buildExecutionTierViolationFraming(v);
    expect(framing).toContain('FORBIDDEN');
    expect(framing).toContain('refactor');
    expect(framing).toContain('explain');
    expect(framing).toMatch(/\bTier\s*1\b|<executionTier>1<\/executionTier>/);
  });

  it('produces a DESIGN_REF_REQUIRES_TIER4-specific retry message naming the matrix', () => {
    const v = new ExecutionTierViolation('DESIGN_REF_REQUIRES_TIER4', {
      nodeLabel: 'Decompose',
      mode: 'generate',
      observedTier: ExecutionTierId.Exploratory,
    });
    const framing = buildExecutionTierViolationFraming(v);
    expect(framing).toContain('design reference document');
    expect(framing).toContain('Development Source');
    expect(framing).toContain('action-config-matrix');
    expect(framing).toContain('<executionTier>4</executionTier>');
    expect(framing).toContain('verification');
  });
});
