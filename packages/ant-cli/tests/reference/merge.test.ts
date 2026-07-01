/**
 * Reference-registration merge — dedup by `project::branch`.
 */
import { describe, it, expect } from 'vitest';
import { mergeReferenceRequests } from '../../src/agents/common/tool/reference/merge';

describe('mergeReferenceRequests', () => {
  it('appends new entries', () => {
    const out = mergeReferenceRequests(undefined, [{ project: 'be' }]);
    expect(out).toEqual([{ project: 'be', branch: undefined, reason: undefined }]);
  });

  it('dedups identical project+branch', () => {
    const out = mergeReferenceRequests([{ project: 'be' }], [{ project: 'be' }]);
    expect(out).toHaveLength(1);
  });

  it('keeps distinct branches of the same project', () => {
    const out = mergeReferenceRequests(
      [{ project: 'be' }],
      [{ project: 'be', branch: 'feature/x' }],
    );
    expect(out).toHaveLength(2);
  });

  it('ignores entries without a project', () => {
    const out = mergeReferenceRequests([], [{ project: '' } as any]);
    expect(out).toHaveLength(0);
  });
});
