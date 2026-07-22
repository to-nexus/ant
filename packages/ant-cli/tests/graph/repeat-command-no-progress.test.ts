/**
 * Repeat-command no-progress signal (shy-crushing-bloom RCA).
 *
 * The incident: a verification task's PLAN tool loop re-ran one failing test
 * 357 consecutive times. The piped command (`vitest ... | grep ... | head`)
 * exited 0 every run, so every failure-gated brake (Safety Net B,
 * isAllRepeatErrorBatch, the loop-detection warning) counted zero, the
 * read-only dup-read signal never fired (the batch was run_command), and the
 * job rode the raw LangGraph recursion limit to a whole-job hard interrupt.
 *
 * Contracts locked here:
 *   1. `hashCommandOutput` — numeral-masked identity (the incident's outputs
 *      oscillated 2627/2628 chars on a timing digit).
 *   2. `appendCommandHistory` — records `outputHash`; emits the success-repeat
 *      advisory at ≥3 identical runs.
 *   3. `isAllRepeatCommandBatch` — success-agnostic repeat detection keyed on
 *      (command, output-hash); output CHANGE keeps the batch informative.
 *   4. Replay — with the incident's shape, `computeNextNoProgressStreak`
 *      reaches `NO_PROGRESS_HARD_CAP` within CAP rounds instead of 357.
 */

import { describe, it, expect } from 'vitest';
import {
  hashCommandOutput,
  computeNextNoProgressStreak,
} from '../../src/agents/architect/graph/code/nodes/execute/drainFinalize';
import {
  isAllRepeatCommandBatch,
} from '../../src/agents/architect/graph/code/nodes/tool/utils/allDupReads';
import {
  appendCommandHistory,
  buildVerifyPlanReminder,
} from '../../src/agents/architect/graph/code/nodes/tool/utils/helpers';
import { NO_PROGRESS_HARD_CAP } from '../../src/agents/architect/graph/code/state';

const CMD = 'npx vitest run src/domain/__tests__/boss-cadence.test.ts -t "scroll-halt periods" 2>&1 | grep -E "FAIL|PASS" | head -10';
const OUTPUT_A = 'FAIL src/domain/__tests__/boss-cadence.test.ts > scroll-halt periods\nAssertionError: expected 5 to be 3\nDuration 2.31s';
// Same outcome, different timing digits — the incident's 2627 vs 2628 chars.
const OUTPUT_A_TIMING = 'FAIL src/domain/__tests__/boss-cadence.test.ts > scroll-halt periods\nAssertionError: expected 5 to be 3\nDuration 12.07s';
// Genuinely different outcome (test now passes after a fix landed).
const OUTPUT_B = 'PASS src/domain/__tests__/boss-cadence.test.ts > scroll-halt periods\nDuration 2.31s';

function commandEvent(command: string, content: string) {
  return {
    toolName: 'run_command',
    args: { command },
    result: {
      content,
      sideEffects: [{ type: 'commandExecuted', command, exitCode: 0, success: true }],
    },
  };
}

// ─── 1. hashCommandOutput ───

describe('hashCommandOutput — numeral-masked identity', () => {
  it('identical outputs hash equal', () => {
    expect(hashCommandOutput(OUTPUT_A)).toBe(hashCommandOutput(OUTPUT_A));
  });

  it('timing-digit drift hashes equal (incident: 2627 vs 2628 chars)', () => {
    expect(hashCommandOutput(OUTPUT_A)).toBe(hashCommandOutput(OUTPUT_A_TIMING));
  });

  it('a changed outcome hashes differently', () => {
    expect(hashCommandOutput(OUTPUT_A)).not.toBe(hashCommandOutput(OUTPUT_B));
  });
});

// ─── 2. appendCommandHistory — outputHash + success-repeat advisory ───

describe('appendCommandHistory — output identity recording', () => {
  it('records outputHash for string results', () => {
    const { history } = appendCommandHistory(undefined, [
      { command: CMD, success: true, exitCode: 0, result: OUTPUT_A },
    ]);
    expect(history[0].outputHash).toBe(hashCommandOutput(OUTPUT_A));
  });

  it('emits the success-repeat advisory at the 3rd identical run — and not before', () => {
    let history: ReturnType<typeof appendCommandHistory>['history'] | undefined;
    let warnings: Map<string, string> = new Map();
    for (let i = 0; i < 3; i++) {
      ({ history, warnings } = appendCommandHistory(history, [
        { command: CMD, success: true, exitCode: 0, result: OUTPUT_A },
      ]));
      if (i < 2) expect(warnings.get(CMD)).toBeUndefined();
    }
    expect(warnings.get(CMD)).toContain('REPEATED COMMAND NOTICE');
  });

  it('no advisory when the output changes between runs', () => {
    let history: ReturnType<typeof appendCommandHistory>['history'] | undefined;
    let warnings: Map<string, string> = new Map();
    for (const out of [OUTPUT_A, OUTPUT_B, OUTPUT_A, OUTPUT_B]) {
      ({ history, warnings } = appendCommandHistory(history, [
        { command: CMD, success: true, exitCode: 0, result: out },
      ]));
    }
    expect(warnings.get(CMD)).toBeUndefined();
  });

  it('failure warning path is unchanged (failures still get the sterner LOOP DETECTION WARNING)', () => {
    let history: ReturnType<typeof appendCommandHistory>['history'] | undefined;
    let warnings: Map<string, string> = new Map();
    for (let i = 0; i < 3; i++) {
      ({ history, warnings } = appendCommandHistory(history, [
        { command: CMD, success: false, exitCode: 1, error: 'boom', result: OUTPUT_A },
      ]));
    }
    expect(warnings.get(CMD)).toContain('LOOP DETECTION WARNING');
  });
});

// ─── 3. isAllRepeatCommandBatch ───

describe('isAllRepeatCommandBatch — success-agnostic repeat predicate', () => {
  const priorWithA = appendCommandHistory(undefined, [
    { command: CMD, success: true, exitCode: 0, result: OUTPUT_A },
  ]).history;

  it('true: same command, identical output already on record', () => {
    expect(isAllRepeatCommandBatch([commandEvent(CMD, OUTPUT_A)], priorWithA)).toBe(true);
  });

  it('true: timing-digit drift still counts as a repeat', () => {
    expect(isAllRepeatCommandBatch([commandEvent(CMD, OUTPUT_A_TIMING)], priorWithA)).toBe(true);
  });

  it('false: output changed (a fix landed — the re-run is informative)', () => {
    expect(isAllRepeatCommandBatch([commandEvent(CMD, OUTPUT_B)], priorWithA)).toBe(false);
  });

  it('false: first run of a command (nothing on record)', () => {
    expect(isAllRepeatCommandBatch([commandEvent(CMD, OUTPUT_A)], [])).toBe(false);
    expect(isAllRepeatCommandBatch([commandEvent(CMD, OUTPUT_A)], undefined)).toBe(false);
  });

  it('false: batch mixes a repeat with a non-command tool (informative batch)', () => {
    const readEvent = { toolName: 'read_file', args: { path: 'a.ts' }, result: { content: 'x' } };
    expect(isAllRepeatCommandBatch(
      [commandEvent(CMD, OUTPUT_A), readEvent as any],
      priorWithA,
    )).toBe(false);
  });

  it('false: empty batch', () => {
    expect(isAllRepeatCommandBatch([], priorWithA)).toBe(false);
  });
});

// ─── 4. Incident replay — streak reaches the cap within CAP rounds ───

describe('replay: shy-crushing-bloom plan-loop repeat reaches the breaker, not 357 rounds', () => {
  it(`streak hits NO_PROGRESS_HARD_CAP (${NO_PROGRESS_HARD_CAP}) after CAP all-repeat batches`, () => {
    let history = appendCommandHistory(undefined, [
      { command: CMD, success: true, exitCode: 0, result: OUTPUT_A },
    ]).history;
    let streak = 0;
    let rounds = 0;
    while (streak < NO_PROGRESS_HARD_CAP && rounds < 400) {
      rounds++;
      const batch = [commandEvent(CMD, OUTPUT_A)];
      const allDup = isAllRepeatCommandBatch(batch, history);
      streak = computeNextNoProgressStreak(
        { _noProgressStreak: streak, _lastToolBatchAllDupReads: allDup },
        { progressed: false, drainFinalizing: false, toolCallCount: 1 },
      );
      history = appendCommandHistory(history, [
        { command: CMD, success: true, exitCode: 0, result: OUTPUT_A },
      ]).history;
    }
    expect(rounds).toBe(NO_PROGRESS_HARD_CAP);
    expect(streak).toBe(NO_PROGRESS_HARD_CAP);
  });

  it('an output change mid-loop resets the streak (no false trip on real progress)', () => {
    const history = appendCommandHistory(undefined, [
      { command: CMD, success: true, exitCode: 0, result: OUTPUT_A },
    ]).history;
    const changedBatch = [commandEvent(CMD, OUTPUT_B)];
    const allDup = isAllRepeatCommandBatch(changedBatch, history);
    const streak = computeNextNoProgressStreak(
      { _noProgressStreak: 10, _lastToolBatchAllDupReads: allDup },
      { progressed: false, drainFinalizing: false, toolCallCount: 1 },
    );
    expect(allDup).toBe(false);
    expect(streak).toBe(0);
  });
});

// ─── 5. Verify-plan recency reminder ───

describe('buildVerifyPlanReminder — verify-mode plan loop recency reminder', () => {
  it('names BOTH legal terminals (batches[] on failure / done on pass)', () => {
    const text = buildVerifyPlanReminder('최종 통합 검증');
    expect(text).toContain('batches[]');
    expect(text).toContain('<done>true</done>');
    expect(text).toContain('최종 통합 검증');
  });

  it('constrains against re-running an already-observed command', () => {
    expect(buildVerifyPlanReminder('t')).toMatch(/Re-running a command.*no new information/);
  });
});
