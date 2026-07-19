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
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyDrainFinalization,
  computeNextNoProgressStreak,
} from '../../src/agents/architect/graph/code/nodes/execute/drainFinalize';
import {
  NO_PROGRESS_HARD_CAP,
  DRAIN_FINALIZE_MARGIN,
} from '../../src/agents/architect/graph/code/state';

const TOOLS = [{ name: 'read_file' }, { name: 'edit_file' }];
const SALVAGE_AT = NO_PROGRESS_HARD_CAP - DRAIN_FINALIZE_MARGIN;

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
    expect(content[1].text).toContain('no progress');
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

  it('passes the drain-stripped tool list to the LLM stream', () => {
    expect(src).toMatch(/applyDrainFinalization\(state, messages, allTools\)/);
  });
});
