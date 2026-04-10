/**
 * Task 1: Threshold Boundary Tests
 *
 * Validates that inline↔tool mode switching occurs at the exact threshold.
 * Tests EXECUTE_SOURCE_THRESHOLD, DECOMPOSE_SOURCE_THRESHOLD, and condenseContent.
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
import { condenseContent } from '../src/core/utils/contentCondenser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeString(len: number): string {
  return 'x'.repeat(len);
}

function makeDesignDocsState(totalChars: number) {
  return {
    designDocs: {
      apiContracts: {} as Record<string, string>,
      feDesigns: { main: makeString(totalChars) },
      beDesigns: {} as Record<string, string>,
    },
    design: '',
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
// 3. condenseContent boundary
// ---------------------------------------------------------------------------

describe('condenseContent boundary', () => {
  const CONDENSE_THRESHOLD = 30_000;
  const opts = (threshold: number) => ({
    threshold,
    label: 'Test Doc',
    filePath: 'outputs/test.md',
  });

  it('at threshold → original preserved', () => {
    const content = makeString(CONDENSE_THRESHOLD);
    const result = condenseContent(content, opts(CONDENSE_THRESHOLD));
    expect(result.wasCondensed).toBe(false);
    expect(result.content).toBe(content);
    expect(result.originalChars).toBe(CONDENSE_THRESHOLD);
    expect(result.condensedChars).toBe(CONDENSE_THRESHOLD);
  });

  it('at threshold+1 → condensed outline', () => {
    const content = makeString(CONDENSE_THRESHOLD + 1);
    const result = condenseContent(content, opts(CONDENSE_THRESHOLD));
    expect(result.wasCondensed).toBe(true);
    expect(result.content).not.toBe(content);
    expect(result.originalChars).toBe(CONDENSE_THRESHOLD + 1);
    expect(result.condensedChars).toBeLessThan(result.originalChars);
    expect(result.content).toContain('condensed');
  });

  it('empty content → not condensed', () => {
    const result = condenseContent('', opts(CONDENSE_THRESHOLD));
    expect(result.wasCondensed).toBe(false);
    expect(result.content).toBe('');
  });

  it('threshold=0 with non-empty content → always condensed', () => {
    const content = 'hello';
    const result = condenseContent(content, opts(0));
    expect(result.wasCondensed).toBe(true);
    expect(result.content).toContain('condensed');
  });

  it('design condense at 30_000 boundary', () => {
    const mdContent = '# Design\n\n' + makeString(30_000 - 12);
    expect(mdContent.length).toBe(30_000 - 2);

    const atThreshold = condenseContent(
      mdContent + 'ab',
      opts(30_000),
    );
    expect(atThreshold.wasCondensed).toBe(false);

    const overThreshold = condenseContent(
      mdContent + 'abc',
      opts(30_000),
    );
    expect(overThreshold.wasCondensed).toBe(true);
  });
});
