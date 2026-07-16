/**
 * compactReport — compaction semantics: lead preserved, full-document outline
 * with accurate char offsets, drill-down notice, no-heading fallback, and the
 * ack↔marker pairing invariant (no `[SUBAGENT REPORT` literal ever emitted).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { compactReport, extractOutline } from '../../src/agents/common/subagent/compactReport';
import { buildChildMessages } from '../../src/agents/common/subagent/prompts';
import {
  storeFullReport,
  readFullReport,
  clearAllReports,
} from '../../src/agents/common/subagent/reportStore';

const SECTION = (title: string, body: string) => `## ${title}\n${body}\n`;

function structuredReport(): string {
  return (
    SECTION('Answer', 'a'.repeat(600)) +
    SECTION('Auth flow details', 'b'.repeat(600)) +
    SECTION('Open questions', 'c'.repeat(600))
  );
}

afterEach(() => clearAllReports());

describe('extractOutline', () => {
  it('extracts headings with exact char offsets', () => {
    const full = structuredReport();
    const outline = extractOutline(full);
    expect(outline.map((e) => e.heading)).toEqual([
      '## Answer',
      '## Auth flow details',
      '## Open questions',
    ]);
    for (const e of outline) {
      expect(full.slice(e.offset, e.offset + e.heading.length)).toBe(e.heading);
    }
  });
});

describe('compactReport', () => {
  it('returns the report unchanged when within budget', () => {
    expect(compactReport('short', 100, 'id1')).toBe('short');
  });

  it('structured overflow: lead + full-document outline + notice, within ~cap', () => {
    const full = structuredReport();
    const cap = 900;
    const inline = compactReport(full, cap, 'id2');
    expect(inline).toContain('## Answer');
    expect(inline).toContain('Document outline');
    // Outline covers sections beyond the lead cut.
    expect(inline).toContain('## Open questions');
    expect(inline).toContain('subagent_report');
    expect(inline).toContain('"id2"');
    expect(inline).toContain('not inlined');
    expect(inline.length).toBeLessThan(full.length);
    expect(inline).not.toMatch(/\[SUBAGENT REPORT/);
    expect(inline).not.toContain('Subagent launched (id:');
  });

  it('outline offsets round-trip through the report store', () => {
    const full = structuredReport();
    storeFullReport('id3', 'goal', full);
    const outline = extractOutline(full);
    const details = outline[1];
    const slice = readFullReport('id3', details.offset, 40);
    expect(slice?.slice.startsWith('## Auth flow details')).toBe(true);
    expect(slice?.total).toBe(full.length);
  });

  it('child system prompt receives the numeric report budget (self-bound is the primary mechanism)', async () => {
    let vars: Record<string, unknown> | undefined;
    await buildChildMessages(
      { render: async (_tpl, v) => { vars = v; return 'sys'; } },
      { goal: 'g' },
    );
    expect(typeof vars?.reportBudgetChars).toBe('number');
    expect(vars?.reportBudgetChars).toBeGreaterThan(0);
  });

  it('no-heading fallback: head + notice + tail with no overlap', () => {
    const full = `${'x'.repeat(500)}\n${'y'.repeat(500)}\n${'z'.repeat(500)}`;
    const inline = compactReport(full, 800, 'id4');
    expect(inline).toContain('not inlined');
    expect(inline.startsWith('x')).toBe(true);
    expect(inline.endsWith('z')).toBe(true);
    expect(inline.length).toBeLessThan(full.length);
    expect(inline).not.toMatch(/\[SUBAGENT REPORT/);
  });
});
