/**
 * reportStore + subagent_report handler — offset paging reassembles the full
 * text, graceful miss, FIFO eviction, persist ceiling.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  storeFullReport,
  readFullReport,
  clearAllReports,
} from '../../src/agents/common/subagent/reportStore';
import { handleSubagentReport } from '../../src/agents/common/tool/handlers/subagentReport';

afterEach(() => {
  clearAllReports();
  delete process.env.ANT_SUBAGENT_MAX_REPORT_PERSIST_CHARS;
});

describe('reportStore', () => {
  it('sequential paging reassembles the exact full text', () => {
    const full = Array.from({ length: 50 }, (_, i) => `line ${i}: ${'x'.repeat(40)}`).join('\n');
    storeFullReport('r1', 'goal', full);
    let out = '';
    let offset = 0;
    for (;;) {
      const slice = readFullReport('r1', offset, 333);
      if (!slice || slice.slice.length === 0) break;
      out += slice.slice;
      offset += slice.slice.length;
      if (offset >= slice.total) break;
    }
    expect(out).toBe(full);
  });

  it('miss returns undefined; out-of-range offset returns an empty tail slice', () => {
    expect(readFullReport('nope')).toBeUndefined();
    storeFullReport('r2', 'g', 'abc');
    const past = readFullReport('r2', 99);
    expect(past?.slice).toBe('');
    expect(past?.total).toBe(3);
  });

  it('FIFO-evicts beyond the store bound', () => {
    for (let i = 0; i < 35; i++) storeFullReport(`id-${i}`, 'g', `report ${i}`);
    expect(readFullReport('id-0')).toBeUndefined();
    expect(readFullReport('id-34')?.slice).toBe('report 34');
  });

  it('applies the persist ceiling at store time', () => {
    process.env.ANT_SUBAGENT_MAX_REPORT_PERSIST_CHARS = '100';
    storeFullReport('r3', 'g', 'x'.repeat(500));
    expect(readFullReport('r3', 0, 1000)?.total).toBe(100);
  });
});

describe('handleSubagentReport', () => {
  it('serves a slice with range framing and paging hint', async () => {
    storeFullReport('r4', 'find auth', 'A'.repeat(50) + 'B'.repeat(50));
    const res = await handleSubagentReport({} as any, { id: 'r4', offset: 50, maxChars: 20 });
    expect(res.error).toBeUndefined();
    expect(res.content).toContain('chars 50-70 of 100');
    expect(res.content).toContain('B'.repeat(20));
    expect(res.content).toContain('continue from offset 70');
    expect(res.content).not.toMatch(/\[SUBAGENT REPORT/);
  });

  it('marks the end of the report on the final slice', async () => {
    storeFullReport('r5', 'g', 'tail');
    const res = await handleSubagentReport({} as any, { id: 'r5' });
    expect(res.content).toContain('End of report.');
  });

  it('graceful miss suggests re-issuing explore, without the marker literal', async () => {
    const res = await handleSubagentReport({} as any, { id: 'gone' });
    expect(res.error).toBeUndefined();
    expect(res.content).toMatch(/re-issue explore/i);
    // The miss must NOT assert a cause it cannot know (sage-causing-rover):
    // a miss can also mean the exploration is still running.
    expect(res.content).not.toContain('was already complete');
    expect(res.content).toContain('still running');
    expect(res.content).not.toMatch(/\[SUBAGENT REPORT/);
  });

  it('missing id is an explicit error', async () => {
    const res = await handleSubagentReport({} as any, {});
    expect(res.error).toBeTruthy();
  });
});
