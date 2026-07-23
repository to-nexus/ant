/**
 * No-progress breaker — boundary-reset lock (anti-retry-spiral).
 *
 * After Safety Net C diverts, the retryable `no_done_signal` violation sends
 * the task through `handleRetryEntry` for a fresh-conversation attempt. If
 * ANY task/attempt boundary fails to reset `_noProgressStreak`, the retry's
 * first router pass still sees a tripped streak and instantly re-diverts —
 * burning the whole retry budget in seconds (the exact 22af62056 failure
 * class this design avoids). This static lock pins every site that resets
 * `_executeCallIndex: 0` to also reset the breaker channels.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SITES = [
  'src/agents/architect/graph/code/nodes/checkTaskStatus/index.ts',
  'src/agents/architect/graph/code/nodes/checkTaskStatus/workerIndex.ts',
  'src/agents/architect/graph/code/parallel/TaskWorker.ts',
];

function read(rel: string): string {
  return readFileSync(resolve(__dirname, '../..', rel), 'utf8');
}

/** Drop comment lines so prose mentions of a channel don't count as resets. */
function codeLines(src: string): string {
  return src
    .split('\n')
    .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
}

describe('no-progress breaker — boundary resets (static)', () => {
  for (const rel of SITES) {
    it(`${rel}: every _executeCallIndex reset is paired with a _noProgressStreak reset`, () => {
      const src = codeLines(read(rel));
      const callIndexResets = (src.match(/_executeCallIndex: 0/g) ?? []).length;
      const streakResets = (src.match(/_noProgressStreak: 0/g) ?? []).length;
      const outputStreakResets = (src.match(/_noOutputStreak: 0/g) ?? []).length;
      const dupFlagResets = (src.match(/_lastToolBatchAllDupReads: false/g) ?? []).length;
      const textRingResets = (src.match(/_recentExecuteTextHashes: \[\]/g) ?? []).length;
      expect(callIndexResets).toBeGreaterThan(0);
      expect(streakResets).toBe(callIndexResets);
      // cyan-catching-cedar: the no-output breaker channel must reset in
      // lockstep with the no-progress streak or a retry re-trips C2 instantly.
      expect(outputStreakResets).toBe(callIndexResets);
      expect(dupFlagResets).toBe(callIndexResets);
      expect(textRingResets).toBe(callIndexResets);
    });
  }

  it('plan handleRetryEntry resets the breaker channels in BOTH mutation and delta', () => {
    const src = read('src/agents/architect/graph/code/nodes/plan/entry/resolve.ts');
    expect(src).toMatch(/state\._noProgressStreak = 0/);
    expect(src).toMatch(/state\._noOutputStreak = 0/);
    expect(src).toMatch(/state\._recentExecuteTextHashes = \[\]/);
    expect(src).toMatch(/state\._lastToolBatchAllDupReads = false/);
    const deltaResets = (src.match(/_noProgressStreak: 0/g) ?? []).length;
    expect(deltaResets).toBeGreaterThanOrEqual(1);
    const deltaOutputResets = (src.match(/_noOutputStreak: 0/g) ?? []).length;
    expect(deltaOutputResets).toBeGreaterThanOrEqual(1);
    const deltaRingResets = (src.match(/_recentExecuteTextHashes: \[\]/g) ?? []).length;
    expect(deltaRingResets).toBeGreaterThanOrEqual(1);
  });

  it('worker subgraph inherits the channels via the CodeGraphChannels spread', () => {
    const graphSrc = read('src/agents/architect/graph/code/graph.ts');
    expect(graphSrc).toMatch(/_noProgressStreak:\s*Annotation/);
    expect(graphSrc).toMatch(/_noOutputStreak:\s*Annotation/);
    expect(graphSrc).toMatch(/_lastToolBatchAllDupReads:\s*Annotation/);
    expect(graphSrc).toMatch(/_recentExecuteTextHashes:\s*Annotation/);
  });
});
