import { describe, it, expect } from 'vitest';
import { generateHumanId } from '../src/utils/humanId';

describe('generateHumanId', () => {
  it('produces adjective-verb-noun format (3 lowercase words, hyphen-separated)', () => {
    for (let i = 0; i < 50; i++) {
      const id = generateHumanId();
      expect(id).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
    }
  });

  it('generates unique IDs over 1000 iterations', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateHumanId());
    }
    // With ~16.7M combinations, 1000 IDs should all be unique
    expect(ids.size).toBe(1000);
  });

  it('has reasonable length bounds', () => {
    for (let i = 0; i < 100; i++) {
      const id = generateHumanId();
      // Shortest possible: 3 chars + 3 chars + 3 chars + 2 hyphens = 11
      // Longest: ~7+8+7+2 = ~24
      expect(id.length).toBeGreaterThanOrEqual(8);
      expect(id.length).toBeLessThanOrEqual(30);
    }
  });
});
