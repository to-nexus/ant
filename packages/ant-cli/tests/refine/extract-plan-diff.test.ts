/**
 * F3.2a — extractPlanDiff cascade test.
 *
 * Pins the priority order:
 *   1. LLM `<updated-sections>` SSOT tag
 *   2. Git unified-diff fallback
 *   3. Directive scan
 * and the dedup behaviour when more than one layer surfaces the same id.
 */

import { describe, it, expect } from 'vitest';
import { extractPlanDiff } from '../../src/core/refine/extractPlanDiff';

describe('extractPlanDiff — single-source layers', () => {
  it('LLM-tag layer extracts identifiers from <updated-sections>', () => {
    const diff = extractPlanDiff({
      doc: 'prd.md',
      llmResponse: 'preamble\n<updated-sections>\nPRD §6, SC-ProductDetail\n</updated-sections>\nbody',
    });
    expect(diff.updatedSections).toEqual(
      expect.arrayContaining(['PRD §6', 'SC-ProductDetail']),
    );
    expect(diff.sources).toEqual(['llm-tag']);
  });

  it('git-diff layer only inspects added/removed lines (not file headers)', () => {
    const gitDiff = [
      '--- a/plan/prd.md',
      '+++ b/plan/prd.md',
      '@@ -10,2 +10,3 @@',
      '-Old prose with PRD §99',
      '+New prose with SC-Search and FR-42',
      ' context line PRD §1',
    ].join('\n');
    const diff = extractPlanDiff({ doc: 'prd.md', gitDiff });
    expect(diff.updatedSections).toContain('SC-Search');
    expect(diff.updatedSections).toContain('FR-42');
    expect(diff.updatedSections).toContain('PRD §99'); // removed line counts as changed
    expect(diff.updatedSections).not.toContain('PRD §1'); // context line skipped
    expect(diff.sources).toEqual(['git-diff']);
  });

  it('directive layer parses identifiers from operator text', () => {
    const diff = extractPlanDiff({
      doc: 'gdd.md',
      directive: 'add EN-Hero and tweak GDD §4 mechanics',
    });
    expect(diff.updatedSections).toEqual(
      expect.arrayContaining(['EN-Hero', 'GDD §4']),
    );
    expect(diff.sources).toEqual(['directive']);
  });
});

describe('extractPlanDiff — cascade dedup', () => {
  it('all three layers contributing surface as union, sources lists each', () => {
    const diff = extractPlanDiff({
      doc: 'prd.md',
      llmResponse: '<updated-sections>PRD §6</updated-sections>',
      gitDiff: '--- a\n+++ b\n@@\n+SC-ProductDetail\n',
      directive: 'and CP-Pagination',
    });
    expect(diff.updatedSections).toEqual(
      expect.arrayContaining(['PRD §6', 'SC-ProductDetail', 'CP-Pagination']),
    );
    expect(diff.sources).toEqual(
      expect.arrayContaining(['llm-tag', 'git-diff', 'directive']),
    );
  });

  it('identifier appearing in multiple layers dedups to one entry', () => {
    const diff = extractPlanDiff({
      doc: 'prd.md',
      llmResponse: '<updated-sections>PRD §6</updated-sections>',
      directive: 'PRD §6 only',
    });
    expect(diff.updatedSections.filter(s => s === 'PRD §6')).toHaveLength(1);
  });
});

describe('extractPlanDiff — empty / missing inputs', () => {
  it('all signals empty → empty output, sources [] (not "no diff" string)', () => {
    const diff = extractPlanDiff({ doc: 'prd.md' });
    expect(diff.updatedSections).toEqual([]);
    expect(diff.sources).toEqual([]);
  });

  it('LLM tag present but body lacks identifiers → falls through to other layers', () => {
    const diff = extractPlanDiff({
      doc: 'prd.md',
      llmResponse: '<updated-sections>just prose, no ids</updated-sections>',
      directive: 'PRD §3 still here',
    });
    expect(diff.updatedSections).toEqual(['PRD §3']);
    expect(diff.sources).toEqual(['directive']);
  });
});
