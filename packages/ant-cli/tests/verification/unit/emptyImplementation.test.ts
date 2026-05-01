import { describe, it, expect } from 'vitest';
import { hasEmptyImplementation } from '../../../src/agents/architect/graph/code/tasks/_shared/verify/emptyImpl';

describe('Axis F-1 — hasEmptyImplementation', () => {
  it('detects empty modify/create/delete with no batches', () => {
    const plan = JSON.stringify({
      task: { id: 'x', goal: 'y' },
      diagnostics: { totalErrors: 0 },
      implementation: { modify: [], create: [], delete: [] },
    });
    expect(hasEmptyImplementation(plan)).toBe(true);
  });

  it('treats missing implementation keys as empty', () => {
    const plan = JSON.stringify({
      task: { id: 'x', goal: 'y' },
      diagnostics: { totalErrors: 0 },
      implementation: {},
    });
    expect(hasEmptyImplementation(plan)).toBe(true);
  });

  it('non-empty modify list is NOT empty', () => {
    const plan = JSON.stringify({
      implementation: { modify: [{ target: 'src/a.ts' }], create: [], delete: [] },
    });
    expect(hasEmptyImplementation(plan)).toBe(false);
  });

  it('plan with batches is NOT empty', () => {
    const plan = JSON.stringify({
      implementation: { modify: [], create: [], delete: [] },
      batches: [{ name: 'one', modify: [{ target: 'src/a.ts' }] }],
    });
    expect(hasEmptyImplementation(plan)).toBe(false);
  });

  it('strips markdown fences before parsing', () => {
    const plan = '```json\n' + JSON.stringify({
      implementation: { modify: [], create: [], delete: [] },
    }) + '\n```';
    expect(hasEmptyImplementation(plan)).toBe(true);
  });

  it('invalid JSON returns false (not empty, so execute normally)', () => {
    expect(hasEmptyImplementation('not json at all')).toBe(false);
  });

  it('undefined/empty string return false', () => {
    expect(hasEmptyImplementation(undefined)).toBe(false);
    expect(hasEmptyImplementation('')).toBe(false);
  });
});
