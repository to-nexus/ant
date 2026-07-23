/**
 * Code execute no-progress salvage + streak rule (rocky-beating-coral RCA).
 *
 * A glm-5.2 worker looped 296 execute rounds / 25 min re-reading the same 13
 * line-range chunks (22 identical sweeps) with zero output. Every existing
 * brake was failure-gated (Safety Net B), verification-gated (Safety Net A),
 * or config-gated (LangGraph recursionLimit) — nothing counts SUCCESSFUL
 * repetition. Contracts locked here:
 *
 *   1. UNIT — `computeNextNoProgressStreak` truth table: progress resets,
 *      all-duplicate batch increments, tool-stripped salvage turn with no
 *      output increments (streak must not freeze once tools are stripped —
 *      the tool node stops running), anything novel resets.
 *   2. UNIT — `applyDrainFinalization` fires exactly at
 *      NO_PROGRESS_HARD_CAP − DRAIN_FINALIZE_MARGIN, PERSISTS while the
 *      trigger holds (sandy-building-dryad: one-shot salvage was answered
 *      with prose and the loop resumed), does NOT use a recursion trigger
 *      (code's near-limit path belongs to Safety Net A + the orchestrator
 *      recursion_limit interrupt), and handles string + block-array content.
 *   3. STATIC — every execute return path commits `_noProgressStreak` and
 *      resets `_lastToolBatchAllDupReads`, so a return path added later
 *      cannot silently drop the channel (the unreturned-channel-drop class).
 *
 * vivid-orbiting-dodge follow-up (2026-07-20) — two blind spots locked:
 *
 *   4. UNIT — repeated-identical-text signal: a degenerate loop can repeat
 *      one sentence verbatim while advancing a NOVEL read cursor (190
 *      rounds / 20 min unseen by the dup-read signal). The text ring
 *      (`_recentExecuteTextHashes`, last 3) catches the observed
 *      A/B-alternating variant; identical text with zero output increments
 *      the same streak.
 *   5. UNIT — drain turn truncated at max_tokens with no open <file> block
 *      jumps the streak to NO_PROGRESS_HARD_CAP (call 219 burned 64K
 *      tokens / 17 min on one repeated sentence; the remaining drain turns
 *      are the same gamble — the router breaker's fresh retry is the
 *      designed escape).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyDrainFinalization,
  computeNextNoProgressStreak,
  computeNextNoOutputStreak,
  computeNextRecentTextHashes,
  isRepeatedAssistantText,
} from '../../src/agents/architect/graph/code/nodes/execute/drainFinalize';
import {
  NO_PROGRESS_HARD_CAP,
  NO_OUTPUT_HARD_CAP,
  DRAIN_FINALIZE_MARGIN,
} from '../../src/agents/architect/graph/code/state';

const TOOLS = [{ name: 'read_file' }, { name: 'edit_file' }];
const SALVAGE_AT = NO_PROGRESS_HARD_CAP - DRAIN_FINALIZE_MARGIN;
const OUTPUT_SALVAGE_AT = NO_OUTPUT_HARD_CAP - DRAIN_FINALIZE_MARGIN;

function userMsg(content: string | any[]) {
  return { role: 'user', content };
}

// ─── 1. Streak rule ───

describe('computeNextNoProgressStreak — truth table', () => {
  const noTurn = { progressed: false, drainFinalizing: false, toolCallCount: 1 };

  it('resets to 0 on progress (streamed files / tool mutation / explicit done)', () => {
    const state = { _noProgressStreak: 9, _lastToolBatchAllDupReads: true };
    expect(computeNextNoProgressStreak(state, { ...noTurn, progressed: true })).toBe(0);
  });

  it('increments when the preceding tool batch was all duplicate-elided reads', () => {
    const state = { _noProgressStreak: 3, _lastToolBatchAllDupReads: true };
    expect(computeNextNoProgressStreak(state, noTurn)).toBe(4);
  });

  it('increments on a tool-stripped salvage turn that still produced nothing', () => {
    const state = { _noProgressStreak: SALVAGE_AT, _lastToolBatchAllDupReads: false };
    expect(computeNextNoProgressStreak(state, {
      progressed: false, drainFinalizing: true, toolCallCount: 0,
    })).toBe(SALVAGE_AT + 1);
  });

  it('resets on a novel batch (not all-duplicate, not a stripped turn)', () => {
    const state = { _noProgressStreak: 7, _lastToolBatchAllDupReads: false };
    expect(computeNextNoProgressStreak(state, noTurn)).toBe(0);
  });

  it('starts from 0 when the channel is unset', () => {
    expect(computeNextNoProgressStreak({}, noTurn)).toBe(0);
    expect(computeNextNoProgressStreak({ _lastToolBatchAllDupReads: true }, noTurn)).toBe(1);
  });

  it('increments on repeated identical text even when reads were novel', () => {
    const state = { _noProgressStreak: 5, _lastToolBatchAllDupReads: false };
    expect(computeNextNoProgressStreak(state, { ...noTurn, repeatedIdenticalText: true })).toBe(6);
  });

  it('progress beats repeated text (a file written while narrating the same sentence is progress)', () => {
    const state = { _noProgressStreak: 5, _lastToolBatchAllDupReads: false };
    expect(computeNextNoProgressStreak(state, {
      ...noTurn, progressed: true, repeatedIdenticalText: true,
    })).toBe(0);
  });

  it('jumps to NO_PROGRESS_HARD_CAP on a drain turn truncated with no open <file> block', () => {
    const state = { _noProgressStreak: SALVAGE_AT + 1, _lastToolBatchAllDupReads: false };
    expect(computeNextNoProgressStreak(state, {
      progressed: false, drainFinalizing: true, toolCallCount: 0, drainTruncatedNoFile: true,
    })).toBe(NO_PROGRESS_HARD_CAP);
  });

  it('drain-truncation escalation never fires on a progressed turn', () => {
    const state = { _noProgressStreak: SALVAGE_AT + 1, _lastToolBatchAllDupReads: false };
    expect(computeNextNoProgressStreak(state, {
      progressed: true, drainFinalizing: true, toolCallCount: 0, drainTruncatedNoFile: true,
    })).toBe(0);
  });
});

// ─── 1a2. No-forward-output streak (cyan-catching-cedar) ───

describe('computeNextNoOutputStreak — truth table', () => {
  it('resets to 0 on forward output (streamed file / mutation / done)', () => {
    const state = { _noOutputStreak: 12 };
    expect(computeNextNoOutputStreak(state, {
      progressed: true, toolCallCount: 1, drainFinalizing: false,
    })).toBe(0);
  });

  it('increments on a tool round that produced no forward output (regardless of read novelty)', () => {
    const state = { _noOutputStreak: 7 };
    expect(computeNextNoOutputStreak(state, {
      progressed: false, toolCallCount: 1, drainFinalizing: false,
    })).toBe(8);
  });

  it('increments on a tool-stripped salvage turn that produced nothing (streak must not freeze)', () => {
    const state = { _noOutputStreak: OUTPUT_SALVAGE_AT };
    expect(computeNextNoOutputStreak(state, {
      progressed: false, toolCallCount: 0, drainFinalizing: true,
    })).toBe(OUTPUT_SALVAGE_AT + 1);
  });

  it('resets on a plain reasoning-only re-entry (no tools, not finalizing)', () => {
    const state = { _noOutputStreak: 5 };
    expect(computeNextNoOutputStreak(state, {
      progressed: false, toolCallCount: 0, drainFinalizing: false,
    })).toBe(0);
  });

  it('starts from 0 when the channel is unset', () => {
    expect(computeNextNoOutputStreak({}, {
      progressed: false, toolCallCount: 1, drainFinalizing: false,
    })).toBe(1);
  });

  it('cyan-catching-cedar replay: 156 novel-read rounds reach the breaker at NO_OUTPUT_HARD_CAP, not 156', () => {
    // final-verification looped ~156 rounds of NOVEL read_file (new line
    // ranges) + novel search_code, zero edits, zero <done>. Each round is
    // information-bearing so _noProgressStreak stays 0; _noOutputStreak is the
    // signal that catches it.
    let state = { _noOutputStreak: 0 };
    let breakerRound = -1;
    for (let round = 1; round <= 156; round++) {
      state = {
        _noOutputStreak: computeNextNoOutputStreak(state, {
          progressed: false,      // no <file>/mutation/<done>
          toolCallCount: 1,       // a novel read or search every round
          drainFinalizing: false,
        }),
      };
      if (breakerRound < 0 && state._noOutputStreak >= NO_OUTPUT_HARD_CAP) breakerRound = round;
    }
    expect(breakerRound).toBe(NO_OUTPUT_HARD_CAP); // ~30, not 156
  });

  it('edits-through-round-18 never trip it: any forward-output round resets the window', () => {
    // The incident edited through round 18 before circling. Interleaved edits
    // must keep the window at 0 — no false positive for productive read→edit.
    let state = { _noOutputStreak: 0 };
    for (let round = 1; round <= 18; round++) {
      const producedOutput = round % 3 === 0; // an edit every 3rd round
      state = {
        _noOutputStreak: computeNextNoOutputStreak(state, {
          progressed: producedOutput, toolCallCount: 1, drainFinalizing: false,
        }),
      };
      expect(state._noOutputStreak).toBeLessThan(NO_OUTPUT_HARD_CAP);
    }
  });
});

// ─── 1b. Repeated-identical-text signal (vivid-orbiting-dodge) ───

describe('recent-text ring — repeated assistant text detection', () => {
  it('detects an exact repeat and is whitespace/case insensitive', () => {
    const ring = computeNextRecentTextHashes([], 'Now I have all the information needed. Let me create the module.');
    expect(isRepeatedAssistantText(ring, 'now  I have all the information needed.\nLet me create the module.')).toBe(true);
  });

  it('does not flag varied narration (healthy execution)', () => {
    let ring: string[] = [];
    const healthy = [
      'Reading the existing test files to understand fixture shapes.',
      'Now checking the source constants that are mirrored in tests.',
      'Verifying the resolveAutoFire signature before writing the module.',
    ];
    for (const text of healthy) {
      expect(isRepeatedAssistantText(ring, text)).toBe(false);
      ring = computeNextRecentTextHashes(ring, text);
    }
  });

  it('catches the observed A/B-alternating degenerate pattern via the 3-ring', () => {
    const a = 'Now I have all the information needed. Let me create the shared test-support module.';
    const b = 'Now I have all the information needed. Let me create the shared test-support module with all fixture builders.';
    let ring: string[] = [];
    ring = computeNextRecentTextHashes(ring, a);
    ring = computeNextRecentTextHashes(ring, b);
    // Third turn repeats A — previous-turn-only comparison would miss this.
    expect(isRepeatedAssistantText(ring, a)).toBe(true);
    expect(isRepeatedAssistantText(ring, b)).toBe(true);
  });

  it('empty text never matches and never enters the ring', () => {
    const ring = computeNextRecentTextHashes([], '   ');
    expect(ring).toEqual([]);
    expect(isRepeatedAssistantText(ring, '')).toBe(false);
  });

  it('ring is bounded to the last 3 non-empty texts', () => {
    let ring: string[] = [];
    for (const t of ['one', 'two', 'three', 'four']) {
      ring = computeNextRecentTextHashes(ring, t);
    }
    expect(ring).toHaveLength(3);
    expect(isRepeatedAssistantText(ring, 'one')).toBe(false);
    expect(isRepeatedAssistantText(ring, 'four')).toBe(true);
  });

  it('incident replay: identical narration + novel reads trips the salvage threshold', () => {
    // vivid-orbiting-dodge execute 14+: same sentence every round, novel
    // read each time (dup-read signal silent). The text signal alone must
    // walk the streak to the salvage threshold.
    const sentence = 'Now I have all the information needed. Let me create the shared test-support module with all fixture builders.';
    let ring: string[] = computeNextRecentTextHashes([], sentence);
    let state = { _noProgressStreak: 0, _lastToolBatchAllDupReads: false };
    for (let round = 0; round < SALVAGE_AT; round++) {
      const repeated = isRepeatedAssistantText(ring, sentence);
      expect(repeated).toBe(true);
      state = {
        ...state,
        _noProgressStreak: computeNextNoProgressStreak(state, {
          progressed: false,
          drainFinalizing: false,
          toolCallCount: 1, // novel read every round
          repeatedIdenticalText: repeated,
        }),
      };
      ring = computeNextRecentTextHashes(ring, sentence);
    }
    expect(state._noProgressStreak).toBe(SALVAGE_AT);
    const messages = [userMsg('go')];
    const { drainFinalizing } = applyDrainFinalization(state, messages, TOOLS);
    expect(drainFinalizing).toBe(true);
  });
});

// ─── 2. Salvage (persistent tool strip) ───

describe('applyDrainFinalization — code execute', () => {
  it('strips tools and appends the note exactly at CAP − MARGIN', () => {
    const messages = [userMsg('apply the plan')];
    const { tools, drainFinalizing } = applyDrainFinalization(
      { _noProgressStreak: SALVAGE_AT }, messages, TOOLS,
    );
    expect(drainFinalizing).toBe(true);
    expect(tools).toEqual([]);
    const content = messages[0].content as any[];
    expect(content[0]).toEqual({ type: 'text', text: 'apply the plan' });
    expect(content[1].text).toContain('no file output');
    expect(content[1].text).toContain('<file path="...">');
    expect(content[1].text).toContain('<done>true</done>');
  });

  it('does not fire below the salvage threshold (boundary exact)', () => {
    const messages = [userMsg('go')];
    const { tools, drainFinalizing } = applyDrainFinalization(
      { _noProgressStreak: SALVAGE_AT - 1 }, messages, TOOLS,
    );
    expect(drainFinalizing).toBe(false);
    expect(tools).toBe(TOOLS);
    expect(messages[0].content).toBe('go');
  });

  it('ALSO fires on the no-output streak at NO_OUTPUT_HARD_CAP − MARGIN (cyan-catching-cedar)', () => {
    const messages = [userMsg('inspect the tests')];
    const { tools, drainFinalizing } = applyDrainFinalization(
      { _noProgressStreak: 0, _noOutputStreak: OUTPUT_SALVAGE_AT }, messages, TOOLS,
    );
    expect(drainFinalizing).toBe(true);
    expect(tools).toEqual([]);
    const content = messages[0].content as any[];
    expect(content[1].text).toContain('no file output');
  });

  it('does not fire on the no-output streak just below its threshold', () => {
    const messages = [userMsg('go')];
    const { drainFinalizing } = applyDrainFinalization(
      { _noProgressStreak: 0, _noOutputStreak: OUTPUT_SALVAGE_AT - 1 }, messages, TOOLS,
    );
    expect(drainFinalizing).toBe(false);
  });

  it('persists for every streak value up to and past the breaker (not one-shot)', () => {
    for (const streak of [SALVAGE_AT, SALVAGE_AT + 1, NO_PROGRESS_HARD_CAP - 1, NO_PROGRESS_HARD_CAP]) {
      const messages = [userMsg('go')];
      const { tools, drainFinalizing } = applyDrainFinalization(
        { _noProgressStreak: streak }, messages, TOOLS,
      );
      expect(drainFinalizing).toBe(true);
      expect(tools).toEqual([]);
    }
  });

  it('releases when the streak resets to 0', () => {
    const messages = [userMsg('go')];
    const { tools, drainFinalizing } = applyDrainFinalization(
      { _noProgressStreak: 0 }, messages, TOOLS,
    );
    expect(drainFinalizing).toBe(false);
    expect(tools).toBe(TOOLS);
  });

  it('appends to block-array user content without disturbing existing blocks', () => {
    const blocks = [
      { type: 'text', text: 'ctx' },
      { type: 'tool_result', tool_use_id: 'x', content: 'r' },
    ];
    const messages = [userMsg(blocks)];
    applyDrainFinalization({ _noProgressStreak: SALVAGE_AT }, messages, TOOLS);
    expect(blocks).toHaveLength(3);
    expect((blocks[2] as any).text).toContain('Apply your remaining changes NOW');
  });

  it('has NO recursion-budget trigger (that path belongs to Safety Net A / orchestrator interrupt)', () => {
    const messages = [userMsg('go')];
    const nearLimit = {
      _noProgressStreak: 0,
      recursionCount: 195,
      recursionLimit: 200,
    } as any;
    const { drainFinalizing } = applyDrainFinalization(nearLimit, messages, TOOLS);
    expect(drainFinalizing).toBe(false);
  });
});

// ─── 3. Static: every execute return path commits the channels ───

describe('code execute node — return-path channel commits (static)', () => {
  const src = readFileSync(
    resolve(__dirname, '../../src/agents/architect/graph/code/nodes/execute/index.ts'),
    'utf8',
  );

  it('commits _noProgressStreak on every return path that commits _lastToolBatchMutatedFiles', () => {
    const mutatedCommits = src.match(/_lastToolBatchMutatedFiles: false/g) ?? [];
    const streakCommits = src.match(/_noProgressStreak: (nextNoProgressStreak|0)/g) ?? [];
    const dupFlagResets = src.match(/_lastToolBatchAllDupReads: false/g) ?? [];
    expect(mutatedCommits.length).toBeGreaterThanOrEqual(4);
    expect(streakCommits.length).toBe(mutatedCommits.length);
    expect(dupFlagResets.length).toBe(mutatedCommits.length);
  });

  it('commits _noOutputStreak on every return path that commits _noProgressStreak (cyan-catching-cedar)', () => {
    const streakCommits = src.match(/_noProgressStreak: (nextNoProgressStreak|0)/g) ?? [];
    const outputCommits = src.match(/_noOutputStreak: (nextNoOutputStreak|0)/g) ?? [];
    expect(outputCommits.length).toBe(streakCommits.length);
  });

  it('commits _recentExecuteTextHashes on every return path that commits the streak', () => {
    const streakCommits = src.match(/_noProgressStreak: (nextNoProgressStreak|0)/g) ?? [];
    const ringCommits = src.match(/_recentExecuteTextHashes: nextTextRing/g) ?? [];
    expect(ringCommits.length).toBe(streakCommits.length);
  });

  it('passes the drain-stripped tool list to the LLM stream', () => {
    expect(src).toMatch(/applyDrainFinalization\(state, messages, allTools\)/);
  });

  it('wires the two vivid-orbiting-dodge signals into the streak computation', () => {
    expect(src).toMatch(/repeatedIdenticalText,/);
    expect(src).toMatch(/drainTruncatedNoFile: drainFinalizing && maxTokensTruncatedNoFile/);
  });

  it('replaces a discarded max_tokens truncation with a head excerpt + marker (history hygiene)', () => {
    expect(src).toMatch(/maxTokensTruncatedNoFile && cleanedResponse\.length > 700/);
    expect(src).toMatch(/without producing any <file> output/);
  });
});
