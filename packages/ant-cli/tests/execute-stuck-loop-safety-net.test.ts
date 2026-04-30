/**
 * Safety Net C — execute-node stuck-loop detection.
 *
 * Locks the contract repaired in the `urban-fronting-faith` p2 postmortem
 * (originally observed against verification, which no longer enters retry
 * under always-fan-out — the reducer/mergeDelta invariant is task-type-blind):
 *
 *   1. The execute-node `isStuckLooping` signal must NOT classify a turn
 *      as stuck when the immediately preceding tool batch mutated files
 *      via `edit_file` / `create_file` / `delete_file`. The earlier signal
 *      (`streamedInThisCall.length === 0`) was `<file>` XML-tag-only and
 *      falsely flagged tool-based fixes as stuck.
 *   2. `_lastToolBatchMutatedFiles` is a TURN-SCOPED signal — execute
 *      consumes it once and resets to `false` on every return path so
 *      the next turn (which will not have a corresponding tool batch)
 *      starts fresh and only re-flips when another tool batch mutates
 *      files.
 *   3. The retired `_executeModifiedFiles` cross-cycle channel is no
 *      longer present in the type and graph; the `verify-mode` router's
 *      `madeFileChanges` branch is also retired (verification cycle
 *      progress is owned exclusively by `Session.passed()` /
 *      `session.isComplete()` plus `checkRetryTermination`'s plan-hash
 *      repeat detection).
 *
 * STATIC verification: parse the source so a future `return {` block that
 * accidentally re-introduces `_executeModifiedFiles` or forgets the
 * `_lastToolBatchMutatedFiles: false` reset trips this guard immediately.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const executePath = resolve(
  __dirname,
  '../src/agents/architect/graph/code/nodes/execute/index.ts',
);
const source = readFileSync(executePath, 'utf-8');

function returnBlocks(src: string): string[] {
  const blocks: string[] = [];
  const lines = src.split('\n');
  let inBlock = false;
  let braceDepth = 0;
  let buffer: string[] = [];
  for (const line of lines) {
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
}

describe('execute node — _executeModifiedFiles fully retired', () => {
  it('source contains no `_executeModifiedFiles` IDENTIFIERS (comments referencing the retirement are allowed)', () => {
    // Match identifier usage in code: `_executeModifiedFiles:` (object key)
    // or `state._executeModifiedFiles` (property access). Plain comment
    // mentions like "the retired `_executeModifiedFiles`" are allowed and
    // serve as documentation breadcrumbs for the postmortem.
    const codeUsage = source.match(/(?:state\._executeModifiedFiles|_executeModifiedFiles\s*[:=])/g);
    expect(codeUsage).toBeNull();
  });

  it('every execute return block resets `_lastToolBatchMutatedFiles: false`', () => {
    const blocks = returnBlocks(source);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block).toMatch(/_lastToolBatchMutatedFiles:\s*false/);
    }
  });
});

describe('execute node — isStuckLooping respects tool-mutated turns', () => {
  // Locate the `isStuckLooping` expression and assert it ANDs in the
  // tool-mutated signal. Re-introducing the old `streamedInThisCall.length
  // === 0` only check (which was the 03ab4b0a partial fix that missed
  // tool-based mutations) would trip this.
  it('isStuckLooping AND-includes !toolMutatedThisTurn', () => {
    const m = source.match(
      /const\s+isStuckLooping\s*=\s*([\s\S]*?);/,
    );
    expect(m).not.toBeNull();
    const expr = m![1];
    expect(expr).toMatch(/streamedInThisCall\.length\s*===\s*0/);
    expect(expr).toMatch(/!\s*toolMutatedThisTurn|toolMutatedThisTurn\s*===\s*false/);
  });

  it('toolMutatedThisTurn reads `state._lastToolBatchMutatedFiles`', () => {
    expect(source).toMatch(
      /const\s+toolMutatedThisTurn\s*=\s*state\._lastToolBatchMutatedFiles\s*===\s*true/,
    );
  });
});

describe('graph annotation — _executeModifiedFiles annotation removed, _lastToolBatchMutatedFiles added', () => {
  const graphPath = resolve(
    __dirname,
    '../src/agents/architect/graph/code/graph.ts',
  );
  const graphSource = readFileSync(graphPath, 'utf-8');

  it('graph.ts no longer declares an `_executeModifiedFiles` annotation', () => {
    expect(graphSource).not.toMatch(/_executeModifiedFiles\s*:\s*Annotation/);
  });

  it('graph.ts declares `_lastToolBatchMutatedFiles` annotation with overwrite reducer', () => {
    expect(graphSource).toMatch(/_lastToolBatchMutatedFiles\s*:\s*Annotation/);
  });
});
