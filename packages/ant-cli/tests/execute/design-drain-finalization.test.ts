/**
 * Drain-time forced finalization — design execute (local-caring-board RCA).
 *
 * When the recursion budget approaches the router drain threshold, the
 * execute node must run exactly ONE tool-less turn that instructs the model
 * to emit its final artifact from already-gathered context, so an imminent
 * recursion-limit pause salvages a written document instead of discarding
 * the exploration. Contracts locked here:
 *
 *   1. UNIT — `applyDrainFinalization` strips tools + appends the
 *      finalization note (string AND block-array user content), fires only
 *      below `RECURSION_DRAIN_THRESHOLD + DRAIN_FINALIZE_MARGIN`, is one-shot
 *      via `_drainFinalized`, and no-ops without a recursionLimit.
 *
 *   2. STATIC — every `return {` block of the design execute node commits
 *      `recursionCount` (the unreturned-channel-drop that starved the drain
 *      guard) and `_drainFinalized` (the one-shot flag), so a future return
 *      path cannot silently regress either.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyDrainFinalization } from '../../src/agents/architect/graph/design/nodes/execute/drainFinalize';
import {
  RECURSION_DRAIN_THRESHOLD,
  DRAIN_FINALIZE_MARGIN,
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
    expect(tools).toEqual([]);
    const content = messages[0].content as any[];
    expect(Array.isArray(content)).toBe(true);
    expect(content[0]).toEqual({ type: 'text', text: 'do the task' });
    expect(content[1].text).toContain('Emit your FINAL output NOW');
    expect(content[1].text).toContain('<done>true</done>');
  });

  it('appends to block-array user content without disturbing existing blocks', () => {
    const blocks = [{ type: 'text', text: 'ctx' }, { type: 'tool_result', tool_use_id: 'x', content: 'r' }];
    const messages = [userMsg(blocks)];
    const state = { recursionLimit: 50, recursionCount: 49 };
    applyDrainFinalization(state, messages, TOOLS);

    expect(blocks).toHaveLength(3);
    expect(blocks[2]).toMatchObject({ type: 'text' });
    expect((blocks[2] as any).text).toContain('FINAL output');
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

  it('is one-shot: a task that already finalized keeps its tools', () => {
    const state = { recursionLimit: 100, recursionCount: 99, _drainFinalized: true };
    const messages = [userMsg('go')];
    const { tools, drainFinalizing } = applyDrainFinalization(state, messages, TOOLS);

    expect(drainFinalizing).toBe(false);
    expect(tools).toBe(TOOLS);
    expect(messages[0].content).toBe('go');
  });

  it('no-ops when recursionLimit is unset (e.g. tests / legacy invokes)', () => {
    const { drainFinalizing } = applyDrainFinalization({}, [userMsg('go')], TOOLS);
    expect(drainFinalizing).toBe(false);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STATIC — per-return-path commit lock on the design execute node.
// Extractor mirrors tests/execute/execute-active-phase.test.ts.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('design execute node — every return commits recursionCount + _drainFinalized', () => {
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

  it.each([['recursionCount:'], ['_drainFinalized:']])('every return block contains %s', (field) => {
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
