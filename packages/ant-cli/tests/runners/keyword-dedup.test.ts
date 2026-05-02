/**
 * L1 — keyword RAG dedup cleanup at batch-split re-queue boundary.
 *
 * Locks the `vast-curling-perch` D-0 fix: when the verification task
 * is re-queued via Path A after a batch-split, the next plan entry
 * for the same task ID must re-fire keyword RAG (not be falsely
 * detected as a duplicate from the previous cycle).
 */

import { describe, it, expect } from 'vitest';
import { KeywordDeduplicator } from '../../src/core/prompt/builder/InputSanitizer';

describe('KeywordDeduplicator.delete (D-0 — vast-curling-perch)', () => {
  it('clearing one task makes its next isDuplicate() call return false', () => {
    const dedup = new KeywordDeduplicator();
    expect(dedup.isDuplicate('task-A')).toBe(false);
    expect(dedup.isDuplicate('task-A')).toBe(true);

    // Path A re-queue: clear the parent's dedup record.
    dedup.delete('task-A');

    // Next plan entry for task-A re-fires keyword RAG.
    expect(dedup.isDuplicate('task-A')).toBe(false);
  });

  it('deleting one task does not affect others', () => {
    const dedup = new KeywordDeduplicator();
    dedup.isDuplicate('task-A');
    dedup.isDuplicate('task-B');

    dedup.delete('task-A');

    // task-A is reset; task-B still flagged as duplicate.
    expect(dedup.isDuplicate('task-A')).toBe(false);
    expect(dedup.isDuplicate('task-B')).toBe(true);
  });
});
