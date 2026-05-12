import { describe, it, expect } from 'vitest';
import { compactContent } from '../../src/core/utils/contentCompactor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJsonContent(keyCount: number): string {
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < keyCount; i++) {
    obj[`section_${i}`] = {
      title: `Section ${i}`,
      items: Array.from({ length: 5 }, (_, j) => `item_${j}`),
    };
  }
  return JSON.stringify(obj, null, 2);
}

function makeUiSpecLikeJson(sectionCount: number): string {
  // Mirrors the shape that triggered the navigation-shell pagination loop:
  // a top-level object with a single "sections" key holding an array of
  // objects, each with an `id` and `name`.
  const sections = Array.from({ length: sectionCount }, (_, i) => ({
    id: `section-${i}`,
    name: `Section ${i}`,
    components: Array.from({ length: 4 }, (_, j) => ({ kind: 'comp', label: `c_${i}_${j}` })),
  }));
  return JSON.stringify({ sections }, null, 2);
}

function makeTopLevelArrayJson(elementCount: number): string {
  const arr = Array.from({ length: elementCount }, (_, i) => ({
    id: `item-${i}`,
    name: `Item ${i}`,
  }));
  return JSON.stringify(arr, null, 2);
}

function makeMarkdownContent(sectionCount: number): string {
  const parts: string[] = ['# Document Title', ''];
  for (let i = 0; i < sectionCount; i++) {
    parts.push(`## Section ${i}`);
    parts.push('');
    parts.push('Lorem ipsum '.repeat(80));
    parts.push('');
  }
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('compactContent', () => {
  describe('below threshold — returns content unchanged', () => {
    it('short JSON', () => {
      const content = '{"a": 1}';
      const result = compactContent(content, {
        threshold: 30_000,
        label: 'small.json',
      });
      expect(result.wasCompacted).toBe(false);
      expect(result.content).toBe(content);
      expect(result.originalChars).toBe(content.length);
      expect(result.compactedChars).toBe(content.length);
    });

    it('short markdown', () => {
      const content = '# Title\n\nHello world';
      const result = compactContent(content, {
        threshold: 30_000,
        label: 'doc.md',
      });
      expect(result.wasCompacted).toBe(false);
      expect(result.content).toBe(content);
    });

    it('exactly at threshold boundary', () => {
      const content = 'x'.repeat(1000);
      const result = compactContent(content, {
        threshold: 1000,
        label: 'exact.txt',
      });
      expect(result.wasCompacted).toBe(false);
    });
  });

  describe('above threshold — compacts with outline', () => {
    it('JSON: produces outline with top-level keys and line numbers', () => {
      const content = makeJsonContent(50);
      expect(content.length).toBeGreaterThan(5000);

      const result = compactContent(content, {
        threshold: 100,
        label: 'ui-assets.json',
        filePath: 'visual/ui/ant/ui-assets.json',
        contentType: 'json',
      });

      expect(result.wasCompacted).toBe(true);
      expect(result.compactedChars).toBeLessThan(result.originalChars);
      expect(result.content).toContain('ui-assets.json');
      expect(result.content).toContain('compacted');
      expect(result.content).toContain('read_file');
      expect(result.content).toContain('startLine=N');
      expect(result.content).toMatch(/L\d+:\s*"section_0"/);
    });

    it('Markdown: produces outline with headings', () => {
      const content = makeMarkdownContent(30);
      expect(content.length).toBeGreaterThan(5000);

      const result = compactContent(content, {
        threshold: 100,
        label: 'spec-main.md',
        filePath: 'architecture/spec/spec-main.md',
      });

      expect(result.wasCompacted).toBe(true);
      expect(result.content).toContain('spec-main.md');
      expect(result.content).toContain('read_file');
      expect(result.content).toMatch(/L1:.*# Document Title/);
      expect(result.content).toMatch(/L\d+:.*## Section 0/);
    });

    it('includes _meta ignore hint when filePath is provided', () => {
      const content = makeJsonContent(50);
      const result = compactContent(content, {
        threshold: 100,
        label: 'test.json',
        filePath: 'architecture/test.json',
      });
      expect(result.content).toContain('_meta');
      expect(result.content).toContain('internal tracking');
    });

    it('omits read_file hint when filePath is not provided', () => {
      const content = makeJsonContent(50);
      const result = compactContent(content, {
        threshold: 100,
        label: 'inline-doc.json',
        contentType: 'json',
      });
      expect(result.wasCompacted).toBe(true);
      expect(result.content).not.toContain('read_file');
    });
  });

  describe('toolHint override', () => {
    it('uses custom tool name in access hint', () => {
      const content = makeJsonContent(50);
      const result = compactContent(content, {
        threshold: 100,
        label: 'source.md',
        filePath: 'plan/prd.md',
        toolHint: 'read_source_doc',
        contentType: 'markdown',
      });
      expect(result.content).toContain('read_source_doc');
      expect(result.content).not.toContain('read_file');
    });
  });

  describe('contentType auto-detection', () => {
    it('detects json from label extension', () => {
      const content = makeJsonContent(50);
      const result = compactContent(content, {
        threshold: 100,
        label: 'data.json',
      });
      expect(result.wasCompacted).toBe(true);
      expect(result.content).toMatch(/L\d+:\s*"section_/);
    });

    it('detects markdown from filePath extension', () => {
      const content = makeMarkdownContent(30);
      const result = compactContent(content, {
        threshold: 100,
        label: 'Design Document',
        filePath: 'architecture/system/fe-system-main.md',
      });
      expect(result.wasCompacted).toBe(true);
      expect(result.content).toMatch(/L\d+:.*# Document Title/);
    });

    it('falls back to markdown for unknown extensions', () => {
      const content = '# Heading\n\n' + 'text '.repeat(10000);
      const result = compactContent(content, {
        threshold: 100,
        label: 'unknown-doc',
      });
      expect(result.wasCompacted).toBe(true);
      expect(result.content).toContain('# Heading');
    });
  });

  describe('array-of-objects element outline', () => {
    it('expands top-level "sections" array with element id labels and line numbers', () => {
      // Reproduces the ui-spec.json shape that caused 23 paged reads on
      // rich-dyeing-blaze: outline must now surface each element so the LLM
      // can target one section without scanning.
      const content = makeUiSpecLikeJson(8);
      const result = compactContent(content, {
        threshold: 100,
        label: 'ui-spec.json',
        filePath: 'visual/ui/ant/ui-spec.json',
        contentType: 'json',
      });

      expect(result.wasCompacted).toBe(true);
      // Top-level key line still surfaced.
      expect(result.content).toMatch(/L\d+:\s*"sections":\s*\[\.\.\.\]\s*\(8 items\)/);
      // Each element expanded with its id and its actual line number.
      expect(result.content).toMatch(/L\d+:\s+\[0\]\s+\(id="section-0"\)/);
      expect(result.content).toMatch(/L\d+:\s+\[7\]\s+\(id="section-7"\)/);
    });

    it('handles a top-level array of objects (no enclosing key)', () => {
      const content = makeTopLevelArrayJson(4);
      const result = compactContent(content, {
        threshold: 100,
        label: 'items.json',
        filePath: 'data/items.json',
        contentType: 'json',
      });

      expect(result.wasCompacted).toBe(true);
      expect(result.content).toMatch(/L1:\s*\[\.\.\.\]\s*\(4 items\)/);
      expect(result.content).toMatch(/L\d+:\s+\[0\]\s+\(id="item-0"\)/);
      expect(result.content).toMatch(/L\d+:\s+\[3\]\s+\(id="item-3"\)/);
    });

    it('caps element expansion at 50 and notes the omitted count', () => {
      const content = makeTopLevelArrayJson(60);
      const result = compactContent(content, {
        threshold: 100,
        label: 'big.json',
        filePath: 'data/big.json',
        contentType: 'json',
      });

      expect(result.wasCompacted).toBe(true);
      // Last surfaced element is index 49; remainder is mentioned.
      expect(result.content).toMatch(/L\d+:\s+\[49\]\s+\(id="item-49"\)/);
      expect(result.content).toMatch(/10 more items omitted/);
    });

    it('does not expand arrays of primitives or mixed-type arrays', () => {
      // makeJsonContent populates each section with `items: ['item_0', ...]`
      // (array of strings). The new expansion logic must skip it — only
      // arrays of plain objects qualify.
      const content = makeJsonContent(3);
      const result = compactContent(content, {
        threshold: 100,
        label: 'mixed.json',
        filePath: 'data/mixed.json',
        contentType: 'json',
      });
      expect(result.wasCompacted).toBe(true);
      // Top-level keys still listed.
      expect(result.content).toMatch(/L\d+:\s*"section_0"/);
      // No `[N] (` element line should appear for the items array.
      expect(result.content).not.toMatch(/\[\d+\]\s+\(.*item_/);
    });
  });

  describe('compact JSON handling', () => {
    it('pretty-prints compact JSON before outline extraction', () => {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < 20; i++) {
        obj[`key_${i}`] = { value: i, nested: { deep: true } };
      }
      const compact = JSON.stringify(obj);
      expect(compact.split('\n').length).toBe(1);
      expect(compact.length).toBeGreaterThan(500);

      const result = compactContent(compact, {
        threshold: 100,
        label: 'compact.json',
        filePath: 'architecture/compact.json',
        contentType: 'json',
      });

      expect(result.wasCompacted).toBe(true);
      expect(result.content).toMatch(/L\d+:\s*"key_0"/);
    });
  });
});
