import { describe, expect, it } from 'vitest';
import { generateHumanId, generateMnemonic } from '../../src/utils/humanId';

describe('generateHumanId', () => {
  it('emits three lowercase words separated by hyphens', () => {
    const id = generateHumanId();
    expect(id).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
  });
});

describe('generateMnemonic', () => {
  it('emits exactly two lowercase words separated by a hyphen', () => {
    const m = generateMnemonic();
    expect(m).toMatch(/^[a-z]+-[a-z]+$/);
  });

  it('1000 draws produce a reasonable variety (<5% collision rate)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateMnemonic());
    // With ~200 adj × ~250 noun = 50k+ combos, 1000 draws should collide
    // very rarely. Allow up to 50 duplicates (5%) to absorb crypto entropy
    // variance without making this a flaky test.
    expect(seen.size).toBeGreaterThan(950);
  });
});
