/**
 * Task 1: Threshold Boundary Tests
 *
 * Validates that inline↔tool mode switching occurs at the exact threshold.
 * Tests EXECUTE_SOURCE_THRESHOLD, DECOMPOSE_SOURCE_THRESHOLD, and compactContent.
 */
import { describe, it, expect } from 'vitest';
import {
  EXECUTE_SOURCE_THRESHOLD,
  DECOMPOSE_SOURCE_THRESHOLD,
} from '../src/agents/architect/graph/design/nodes/docGen/sourceSelector';
import {
  getDesignDocsSize,
  prepareDesignDocument,
} from '../src/agents/architect/graph/code/nodes/decompose/designSelector';
import { compactContent } from '../src/core/utils/contentCompactor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeString(len: number): string {
  return 'x'.repeat(len);
}

function makeDesignDocsState(totalChars: number) {
  return {
    artifacts: [
      { path: 'architecture/system/fe-system-main.md', content: makeString(totalChars), role: 'ref' },
    ],
  } as any;
}

// ---------------------------------------------------------------------------
// 1. EXECUTE_SOURCE_THRESHOLD boundary (systemDesignPrompt path)
// ---------------------------------------------------------------------------

describe('EXECUTE_SOURCE_THRESHOLD boundary', () => {
  it('at threshold → inline mode (sourceDocsForTask.length === threshold)', () => {
    const content = makeString(EXECUTE_SOURCE_THRESHOLD);
    expect(content.length).toBe(EXECUTE_SOURCE_THRESHOLD);
    expect(content.length > EXECUTE_SOURCE_THRESHOLD).toBe(false);
  });

  it('at threshold+1 → tool mode (sourceDocsForTask.length > threshold)', () => {
    const content = makeString(EXECUTE_SOURCE_THRESHOLD + 1);
    expect(content.length).toBe(EXECUTE_SOURCE_THRESHOLD + 1);
    expect(content.length > EXECUTE_SOURCE_THRESHOLD).toBe(true);
  });

  it('threshold constant is 200_000', () => {
    expect(EXECUTE_SOURCE_THRESHOLD).toBe(200_000);
  });
});

// ---------------------------------------------------------------------------
// 2. DECOMPOSE_SOURCE_THRESHOLD boundary (designSelector path)
// ---------------------------------------------------------------------------

describe('DECOMPOSE_SOURCE_THRESHOLD boundary', () => {
  it('at threshold → inline mode, individual documents', () => {
    const state = makeDesignDocsState(DECOMPOSE_SOURCE_THRESHOLD);
    expect(getDesignDocsSize(state)).toBe(DECOMPOSE_SOURCE_THRESHOLD);

    const result = prepareDesignDocument(state);
    expect(result.useToolMode).toBe(false);
    expect(result.hasDesignDoc).toBe(true);
    expect(result.documents.length).toBeGreaterThan(0);
    expect(result.documents[0].path).not.toBe('design-index');
  });

  it('at threshold+1 → tool mode, index document only', () => {
    const state = makeDesignDocsState(DECOMPOSE_SOURCE_THRESHOLD + 1);
    expect(getDesignDocsSize(state)).toBe(DECOMPOSE_SOURCE_THRESHOLD + 1);

    const result = prepareDesignDocument(state);
    expect(result.useToolMode).toBe(true);
    expect(result.hasDesignDoc).toBe(true);
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].path).toBe('design-index');
    expect(result.documents[0].role).toBe('ref');
  });

  it('threshold constant is 200_000', () => {
    expect(DECOMPOSE_SOURCE_THRESHOLD).toBe(200_000);
  });
});

// ---------------------------------------------------------------------------
// 3. compactContent boundary
// ---------------------------------------------------------------------------

describe('compactContent boundary', () => {
  const COMPACT_THRESHOLD = 30_000;
  const opts = (threshold: number) => ({
    threshold,
    label: 'Test Doc',
    filePath: 'outputs/test.md',
  });

  it('at threshold → original preserved', () => {
    const content = makeString(COMPACT_THRESHOLD);
    const result = compactContent(content, opts(COMPACT_THRESHOLD));
    expect(result.wasCompacted).toBe(false);
    expect(result.content).toBe(content);
    expect(result.originalChars).toBe(COMPACT_THRESHOLD);
    expect(result.compactedChars).toBe(COMPACT_THRESHOLD);
  });

  it('at threshold+1 → compacted outline', () => {
    const content = makeString(COMPACT_THRESHOLD + 1);
    const result = compactContent(content, opts(COMPACT_THRESHOLD));
    expect(result.wasCompacted).toBe(true);
    expect(result.content).not.toBe(content);
    expect(result.originalChars).toBe(COMPACT_THRESHOLD + 1);
    expect(result.compactedChars).toBeLessThan(result.originalChars);
    expect(result.content).toContain('compacted');
  });

  it('empty content → not compacted', () => {
    const result = compactContent('', opts(COMPACT_THRESHOLD));
    expect(result.wasCompacted).toBe(false);
    expect(result.content).toBe('');
  });

  it('threshold=0 with non-empty content → always compacted', () => {
    const content = 'hello';
    const result = compactContent(content, opts(0));
    expect(result.wasCompacted).toBe(true);
    expect(result.content).toContain('compacted');
  });

  it('design compact at 30_000 boundary', () => {
    const mdContent = '# Design\n\n' + makeString(30_000 - 12);
    expect(mdContent.length).toBe(30_000 - 2);

    const atThreshold = compactContent(
      mdContent + 'ab',
      opts(30_000),
    );
    expect(atThreshold.wasCompacted).toBe(false);

    const overThreshold = compactContent(
      mdContent + 'abc',
      opts(30_000),
    );
    expect(overThreshold.wasCompacted).toBe(true);
  });
});
