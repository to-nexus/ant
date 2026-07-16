/**
 * Drain + orphan protocol:
 * - buildReportBlocks marker shape
 * - detectOrphanedLaunches: ack without marker/registry → LOST exactly once
 *   (self-idempotent via the injected marker)
 * - live registry entries and already-reported acks are NOT orphans
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildLaunchAck,
  buildReportBlocks,
  detectOrphanedLaunches,
  reportMarker,
} from '../../src/agents/common/subagent/drain';
import { launchEntry, clearAll } from '../../src/agents/common/subagent/registry';
import type { SubagentEntry, SubagentResult } from '../../src/agents/common/subagent/types';

const OWNER = 'job1:_main_';

beforeEach(() => clearAll());
afterEach(() => clearAll());

function settledEntry(id: string, report: string): SubagentEntry {
  return {
    id, ownerKey: OWNER, goal: 'the goal', status: 'settled',
    promise: Promise.resolve(), launchedAt: Date.now(), delivered: false,
    result: { report, rounds: 1, state: 'done' } satisfies SubagentResult,
  };
}

describe('buildReportBlocks', () => {
  it('wraps each report with its pairing marker and goal', () => {
    const blocks = buildReportBlocks([settledEntry('abc', 'body text')]);
    expect(blocks).toHaveLength(1);
    const text = (blocks[0] as any).text as string;
    expect(text.startsWith(reportMarker('abc'))).toBe(true);
    expect(text).toContain('(goal: the goal)');
    expect(text).toContain('body text');
  });
});

describe('detectOrphanedLaunches', () => {
  const historyWithAck = (id: string) => [
    { role: 'assistant', content: [{ type: 'tool_use', id, name: 'explore', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: buildLaunchAck(id, 'g') }] },
  ];

  it('ack with no marker and no registry entry → LOST block', () => {
    const blocks = detectOrphanedLaunches(historyWithAck('orphan1'), OWNER);
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as any).text).toContain(`${reportMarker('orphan1')} — LOST`);
    expect((blocks[0] as any).text).toContain('Re-issue explore');
  });

  it('self-idempotent: once the LOST marker is in history, no second LOST', () => {
    const first = detectOrphanedLaunches(historyWithAck('orphan2'), OWNER);
    const history = [
      ...historyWithAck('orphan2'),
      { role: 'user', content: first as any },
    ];
    expect(detectOrphanedLaunches(history, OWNER)).toHaveLength(0);
  });

  it('a delivered report marker in history pairs the ack (no orphan)', () => {
    const history = [
      ...historyWithAck('done1'),
      { role: 'user', content: [{ type: 'text', text: `${reportMarker('done1')} (goal: g)\nfindings` }] },
    ];
    expect(detectOrphanedLaunches(history, OWNER)).toHaveLength(0);
  });

  it('a live registry entry is not an orphan (report still coming)', () => {
    launchEntry({
      id: 'live1', ownerKey: OWNER, goal: 'g',
      run: () => new Promise(() => { /* pending */ }),
    });
    expect(detectOrphanedLaunches(historyWithAck('live1'), OWNER)).toHaveLength(0);
  });

  it('string-content messages are scanned too', () => {
    const history = [{ role: 'user', content: buildLaunchAck('str1', 'g') }];
    expect(detectOrphanedLaunches(history, OWNER)).toHaveLength(1);
  });
});
