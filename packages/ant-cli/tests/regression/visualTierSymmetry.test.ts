/**
 * Visual Tier Explicit vs Infer symmetry guard.
 *
 * For each of visualLanguage / surfaceSystem / spatialSystem:
 *   - userPreset value present → that value wins (explicit path).
 *   - userPreset value absent   → detected value from LLM response is used (infer path).
 *
 * spatialSystem has no FE wizard entry point, so its preset value can only
 * arrive via legacy stored basis. The resolver must still honor it when
 * present, and infer from LLM output when not.
 */
import { describe, it, expect } from 'vitest';
import { resolveVisualTierFromDecompose } from '../../src/agents/common/visualTierResolver';

const TAG = (obj: Record<string, unknown>) =>
  `<visualTier>${JSON.stringify(obj)}</visualTier>`;

describe('resolveVisualTierFromDecompose — explicit vs infer symmetry', () => {
  const rawAll = TAG({
    visualLanguage: 'cleanBright',
    surfaceSystem: 'glassLight',
    spatialSystem: 'airy8pt',
    screenContext: 'dashboard',
  });

  it('fills all three layers from LLM when no preset exists (infer path)', () => {
    const result = resolveVisualTierFromDecompose(rawAll, undefined);
    expect(result).toBeDefined();
    expect(result!.visualLanguage).toBe('cleanBright');
    expect(result!.surfaceSystem).toBe('glassLight');
    expect(result!.spatialSystem).toBe('airy8pt');
  });

  it('preset visualLanguage wins over LLM choice (explicit)', () => {
    const result = resolveVisualTierFromDecompose(rawAll, { visualLanguage: 'enterprise' });
    expect(result!.visualLanguage).toBe('enterprise');
    expect(result!.surfaceSystem).toBe('glassLight');
    expect(result!.spatialSystem).toBe('airy8pt');
  });

  it('preset surfaceSystem wins over LLM choice (explicit)', () => {
    const result = resolveVisualTierFromDecompose(rawAll, { surfaceSystem: 'solid' });
    expect(result!.visualLanguage).toBe('cleanBright');
    expect(result!.surfaceSystem).toBe('solid');
    expect(result!.spatialSystem).toBe('airy8pt');
  });

  it('preset spatialSystem wins over LLM choice (explicit — legacy path)', () => {
    const result = resolveVisualTierFromDecompose(rawAll, { spatialSystem: 'compact8pt' });
    expect(result!.spatialSystem).toBe('compact8pt');
  });

  it('empty preset + empty LLM output returns undefined', () => {
    const result = resolveVisualTierFromDecompose('no tag here', undefined);
    expect(result).toBeUndefined();
  });

  it('derives interactionGrammar from visualLanguage (pure function)', () => {
    const result = resolveVisualTierFromDecompose(rawAll, undefined);
    expect(result!.interactionGrammar).toBeDefined();
  });

  it('derives visualHierarchyRules from VL + spatialSystem (pure function)', () => {
    const result = resolveVisualTierFromDecompose(rawAll, undefined);
    expect(result!.visualHierarchyRules).toBeDefined();
  });
});
