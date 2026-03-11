import { describe, it, expect } from 'vitest';
import { condenseContent } from '../src/core/utils/contentCondenser';

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

describe('condenseContent', () => {
  describe('below threshold — returns content unchanged', () => {
    it('short JSON', () => {
      const content = '{"a": 1}';
      const result = condenseContent(content, {
        threshold: 30_000,
        label: 'small.json',
      });
      expect(result.wasCondensed).toBe(false);
      expect(result.content).toBe(content);
      expect(result.originalChars).toBe(content.length);
      expect(result.condensedChars).toBe(content.length);
    });

    it('short markdown', () => {
      const content = '# Title\n\nHello world';
      const result = condenseContent(content, {
        threshold: 30_000,
        label: 'doc.md',
      });
      expect(result.wasCondensed).toBe(false);
      expect(result.content).toBe(content);
    });

    it('exactly at threshold boundary', () => {
      const content = 'x'.repeat(1000);
      const result = condenseContent(content, {
        threshold: 1000,
        label: 'exact.txt',
      });
      expect(result.wasCondensed).toBe(false);
    });
  });

  describe('above threshold — condenses with outline', () => {
    it('JSON: produces outline with top-level keys and line numbers', () => {
      const content = makeJsonContent(50);
      expect(content.length).toBeGreaterThan(5000);

      const result = condenseContent(content, {
        threshold: 100,
        label: 'ui-assets.json',
        filePath: 'outputs/design/ui-assets.json',
        contentType: 'json',
      });

      expect(result.wasCondensed).toBe(true);
      expect(result.condensedChars).toBeLessThan(result.originalChars);
      expect(result.content).toContain('ui-assets.json');
      expect(result.content).toContain('condensed');
      expect(result.content).toContain('read_file');
      expect(result.content).toContain('startLine=N');
      // Outline should contain line-numbered keys
      expect(result.content).toMatch(/L\d+:\s*"section_0"/);
    });

    it('Markdown: produces outline with headings', () => {
      const content = makeMarkdownContent(30);
      expect(content.length).toBeGreaterThan(5000);

      const result = condenseContent(content, {
        threshold: 100,
        label: 'spec-main.md',
        filePath: 'outputs/design/spec-main.md',
      });

      expect(result.wasCondensed).toBe(true);
      expect(result.content).toContain('spec-main.md');
      expect(result.content).toContain('read_file');
      // Outline should contain heading entries
      expect(result.content).toMatch(/L1:.*# Document Title/);
      expect(result.content).toMatch(/L\d+:.*## Section 0/);
    });

    it('includes _meta ignore hint when filePath is provided', () => {
      const content = makeJsonContent(50);
      const result = condenseContent(content, {
        threshold: 100,
        label: 'test.json',
        filePath: 'outputs/design/test.json',
      });
      expect(result.content).toContain('_meta');
      expect(result.content).toContain('internal tracking');
    });

    it('omits read_file hint when filePath is not provided', () => {
      const content = makeJsonContent(50);
      const result = condenseContent(content, {
        threshold: 100,
        label: 'inline-doc.json',
        contentType: 'json',
      });
      expect(result.wasCondensed).toBe(true);
      expect(result.content).not.toContain('read_file');
    });
  });

  describe('toolHint override', () => {
    it('uses custom tool name in access hint', () => {
      const content = makeJsonContent(50);
      const result = condenseContent(content, {
        threshold: 100,
        label: 'source.md',
        filePath: 'inputs/sources/prd.md',
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
      const result = condenseContent(content, {
        threshold: 100,
        label: 'data.json',
      });
      expect(result.wasCondensed).toBe(true);
      expect(result.content).toMatch(/L\d+:\s*"section_/);
    });

    it('detects markdown from filePath extension', () => {
      const content = makeMarkdownContent(30);
      const result = condenseContent(content, {
        threshold: 100,
        label: 'Design Document',
        filePath: 'outputs/design/fe-system-main.md',
      });
      expect(result.wasCondensed).toBe(true);
      expect(result.content).toMatch(/L\d+:.*# Document Title/);
    });

    it('falls back to markdown for unknown extensions', () => {
      const content = '# Heading\n\n' + 'text '.repeat(10000);
      const result = condenseContent(content, {
        threshold: 100,
        label: 'unknown-doc',
      });
      expect(result.wasCondensed).toBe(true);
      expect(result.content).toContain('# Heading');
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

      const result = condenseContent(compact, {
        threshold: 100,
        label: 'compact.json',
        filePath: 'outputs/design/compact.json',
        contentType: 'json',
      });

      expect(result.wasCondensed).toBe(true);
      expect(result.content).toMatch(/L\d+:\s*"key_0"/);
    });
  });
});
