/**
 * Drain-time forced finalization — design execute (local-caring-board RCA,
 * persistence hardened after sandy-building-dryad).
 *
 * When the recursion budget approaches the router drain threshold OR the
 * no-output streak nears the circuit breaker, execute turns run tool-less
 * with an "emit your final artifact now" note, so an imminent pause salvages
 * a written document instead of discarding the exploration. Contracts locked
 * here:
 *
 *   1. UNIT — `applyDrainFinalization` strips tools + appends the
 *      finalization note (string AND block-array user content), fires only
 *      below `RECURSION_DRAIN_THRESHOLD + DRAIN_FINALIZE_MARGIN` (or at
 *      no-output streak ≥ NO_OUTPUT_HARD_CAP - DRAIN_FINALIZE_MARGIN),
 *      PERSISTS while a trigger holds (sandy-building-dryad: the one-shot
 *      salvage was answered with prose, tools came back, and the model read
 *      on until the breaker fired with zero output), and no-ops without a
 *      recursionLimit or streak.
 *
 *   2. STATIC — every `return {` block of the design execute node commits
 *      `recursionCount` (the unreturned-channel-drop that starved the drain
 *      guard), so a future return path cannot silently regress it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyDrainFinalization,
  computeNextNoOutputCount,
} from '../../src/agents/architect/graph/design/nodes/execute/drainFinalize';
import {
  RECURSION_DRAIN_THRESHOLD,
  DRAIN_FINALIZE_MARGIN,
  NO_OUTPUT_HARD_CAP,
} from '../../src/agents/architect/graph/design/routers/executeRouter';

const TOOLS = [{ name: 'read_file' }, { name: 'search_code' }];

function userMsg(content: string | any[]) {
  return { role: 'user', content };
}

describe('applyDrainFinalization — unit', () => {
  it('strips tools and appends the note when the budget crosses the finalize threshold', () => {
    const messages = [userMsg('do the task')];
    const state = { recursionLimit: 100, recursionCount: 100 - (RECURSION_DRAIN_THRESHOLD + DRAIN_FINALIZE_MARGIN) + 1 };
    const { tools, drainFinalizing } = applyDrainFinalization(state, messages, TOOLS);

    expect(drainFinalizing).toBe(true);
    // Exploration tools stripped (write tools would be kept — see the
    // dedicated keep-write-tools case in execute-tool-write-completion.test.ts).
    expect(tools).toEqual([]);
    const content = messages[0].content as any[];
    expect(Array.isArray(content)).toBe(true);
    expect(content[0]).toEqual({ type: 'text', text: 'do the task' });
    expect(content[1].text).toContain('Finish NOW');
    // Channel-complete salvage note: XML tags AND the REVISE edit_file path.
    expect(content[1].text).toContain('edit_file');
    expect(content[1].text).toContain('<done>true</done>');
  });

  it('appends to block-array user content without disturbing existing blocks', () => {
    const blocks = [{ type: 'text', text: 'ctx' }, { type: 'tool_result', tool_use_id: 'x', content: 'r' }];
    const messages = [userMsg(blocks)];
    const state = { recursionLimit: 50, recursionCount: 49 };
    applyDrainFinalization(state, messages, TOOLS);

    expect(blocks).toHaveLength(3);
    expect(blocks[2]).toMatchObject({ type: 'text' });
    expect((blocks[2] as any).text).toContain('Finish NOW');
  });

  it('does not fire while ample budget remains (boundary exact)', () => {
    const atBoundary = {
      recursionLimit: 200,
      recursionCount: 200 - (RECURSION_DRAIN_THRESHOLD + DRAIN_FINALIZE_MARGIN),
    };
    const messages = [userMsg('go')];
    const { tools, drainFinalizing } = applyDrainFinalization(atBoundary, messages, TOOLS);

    expect(drainFinalizing).toBe(false);
    expect(tools).toBe(TOOLS);
    expect(messages[0].content).toBe('go');
  });

  it('persists across turns while the recursion trigger holds (not one-shot)', () => {
    // Same task, next turn: budget only tightened. The strip must hold —
    // returning the tools after one salvage turn let the model resume
    // reading until the breaker fired with zero output (sandy-building-dryad).
    for (const count of [99, 100]) {
      const messages = [userMsg('go')];
      const { tools, drainFinalizing } = applyDrainFinalization(
        { recursionLimit: 100, recursionCount: count },
        messages,
        TOOLS,
      );
      expect(drainFinalizing).toBe(true);
      expect(tools).toEqual([]);
      expect((messages[0].content as any[])[1].text).toContain('Finish NOW');
    }
  });

  it('fires on the no-output streak trigger and persists until the streak resets', () => {
    const margin = NO_OUTPUT_HARD_CAP - DRAIN_FINALIZE_MARGIN;
    // Below the margin: tools untouched.
    {
      const messages = [userMsg('go')];
      const { tools, drainFinalizing } = applyDrainFinalization(
        { _noOutputCallCount: margin - 1 },
        messages,
        TOOLS,
      );
      expect(drainFinalizing).toBe(false);
      expect(tools).toBe(TOOLS);
    }
    // At and above the margin (every remaining pre-breaker turn): stripped.
    for (const streak of [margin, margin + 1, NO_OUTPUT_HARD_CAP - 1]) {
      const messages = [userMsg('go')];
      const { tools, drainFinalizing } = applyDrainFinalization(
        { _noOutputCallCount: streak },
        messages,
        TOOLS,
      );
      expect(drainFinalizing).toBe(true);
      expect(tools).toEqual([]);
      expect((messages[0].content as any[])[1].text).toContain(`${streak} turns without writing`);
    }
    // A file write resets the streak channel → strip releases.
    {
      const messages = [userMsg('go')];
      const { tools, drainFinalizing } = applyDrainFinalization(
        { _noOutputCallCount: 0 },
        messages,
        TOOLS,
      );
      expect(drainFinalizing).toBe(false);
      expect(tools).toBe(TOOLS);
    }
  });

  it('no-ops when recursionLimit is unset and no streak accrued (e.g. tests / legacy invokes)', () => {
    const { drainFinalizing } = applyDrainFinalization({}, [userMsg('go')], TOOLS);
    expect(drainFinalizing).toBe(false);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// computeNextNoOutputCount — the counter MUST climb through the persistent
// tool-strip so the router breaker (NO_OUTPUT_HARD_CAP) is reachable.
// round-grading-sable: the old increment counted only tool-call turns, so once
// the strip persisted at CAP-MARGIN the counter froze there and the breaker
// never fired → infinite prose loop. This is the design twin of the code job's
// `computeNextNoOutputStreak` `|| turn.drainFinalizing` clause.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('computeNextNoOutputCount', () => {
  it('a file write resets the streak', () => {
    expect(
      computeNextNoOutputCount(19, { hasNewFileOutput: true, hasToolCallsOnly: false, drainFinalizing: false }),
    ).toBe(0);
  });

  it('a tool-only turn increments', () => {
    expect(
      computeNextNoOutputCount(3, { hasNewFileOutput: false, hasToolCallsOnly: true, drainFinalizing: false }),
    ).toBe(4);
  });

  it('a drain-finalizing (tool-stripped, no output) turn increments — no freeze', () => {
    expect(
      computeNextNoOutputCount(20, { hasNewFileOutput: false, hasToolCallsOnly: false, drainFinalizing: true }),
    ).toBe(21);
  });

  it('climbs from the strip margin to the hard cap instead of freezing (round-grading-sable replay)', () => {
    const margin = NO_OUTPUT_HARD_CAP - DRAIN_FINALIZE_MARGIN; // 20
    let streak = margin;
    // Every turn from the margin on is tool-stripped (drainFinalizing) prose —
    // no file, no tool calls. The counter must reach the cap in <= MARGIN turns.
    for (let i = 0; i < DRAIN_FINALIZE_MARGIN + 2 && streak < NO_OUTPUT_HARD_CAP; i++) {
      streak = computeNextNoOutputCount(streak, {
        hasNewFileOutput: false,
        hasToolCallsOnly: false,
        drainFinalizing: true,
      });
    }
    expect(streak).toBeGreaterThanOrEqual(NO_OUTPUT_HARD_CAP);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STATIC — per-return-path commit lock on the design execute node.
// Extractor mirrors tests/execute/execute-active-phase.test.ts.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('design execute node — every return commits recursionCount', () => {
  const source = readFileSync(
    resolve(__dirname, '../../src/agents/architect/graph/design/nodes/execute/index.ts'),
    'utf-8',
  );

  const returnBlocks = (() => {
    const blocks: string[] = [];
    let inBlock = false;
    let braceDepth = 0;
    let buffer: string[] = [];
    for (const line of source.split('\n')) {
      if (!inBlock) {
        if (/^\s*return\s*\{\s*$/.test(line)) {
          inBlock = true;
          braceDepth = 1;
          buffer = [line];
        }
        continue;
      }
      buffer.push(line);
      for (const ch of line) {
        if (ch === '{') braceDepth++;
        else if (ch === '}') braceDepth--;
      }
      if (braceDepth === 0) {
        blocks.push(buffer.join('\n'));
        inBlock = false;
        buffer = [];
      }
    }
    return blocks;
  })();

  it('finds the known return blocks', () => {
    expect(returnBlocks.length).toBeGreaterThanOrEqual(2);
  });

  it.each([['recursionCount:']])('every return block contains %s', (field) => {
    for (const [i, block] of returnBlocks.entries()) {
      expect(
        block.includes(field),
        `design execute return block #${i + 1} missing \`${field}\` — ` +
          `an unreturned last-value channel is dropped at the node transition ` +
          `(drain-guard starvation, local-caring-board RCA)\n${block.slice(0, 300)}`,
      ).toBe(true);
    }
  });
});
