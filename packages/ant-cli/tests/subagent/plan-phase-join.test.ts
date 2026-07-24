/**
 * Plan-phase explore-subagent join barrier (round-grading-sable).
 *
 * The code plan phase has no finalize-time join like execute; its only
 * per-round delivery is the tool node's drain, which fires only on tool-call
 * rounds. `deliverOwedExploreReports` closes the gap: on tool-loop fallthrough
 * (the plan LLM stalled with no <plan> and no tool calls) it force-delivers any
 * owed explore reports into NODE_PLAN so the fresh plan-LLM call is formed with
 * the findings — instead of looping "waiting for the subagent reports" forever.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { __testing__ } from '../../src/agents/architect/graph/code/nodes/plan/index';
import { ownerKeyFor } from '../../src/agents/common/subagent/seam';
import { launchEntry, clearAll } from '../../src/agents/common/subagent/registry';
import { CONV_KEYS } from '../../src/agents/common/graph/conversations';
import type { SubagentResult } from '../../src/agents/common/subagent/types';

const { deliverOwedExploreReports } = __testing__;

const JOB_ID = 'jobJ';
// No worker scope in the test → workerScopeKey() resolves to `_main_`.
const OWNER = ownerKeyFor(JOB_ID);

function settledEntry(id: string, report: string) {
  launchEntry({
    id,
    ownerKey: OWNER,
    goal: `goal-${id}`,
    run: async (): Promise<SubagentResult> => ({
      report,
      rounds: 1,
      state: 'done',
      modelId: 'child-m',
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    }),
  });
}

function freshState(nodePlan: Array<{ role: string; content: any }>) {
  return {
    _httpJobId: JOB_ID,
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    tokenUsageByModel: {},
    conversations: { [CONV_KEYS.NODE_PLAN]: nodePlan },
  } as Record<string, any>;
}

beforeEach(() => clearAll());
afterEach(() => clearAll());

describe('deliverOwedExploreReports (plan-phase join barrier)', () => {
  it('injects owed reports into NODE_PLAN and folds token usage', async () => {
    settledEntry('p1', 'HUD anchors live in game-screen.module.css L179');
    const state = freshState([
      { role: 'user', content: 'plan this' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'read_file', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'file body' }] },
    ]);
    const entryDelta: Record<string, any> = {};

    await deliverOwedExploreReports(state, entryDelta);

    const updated = state.conversations[CONV_KEYS.NODE_PLAN];
    const serialized = JSON.stringify(updated);
    expect(serialized).toContain('HUD anchors live in game-screen.module.css');
    // Report delivered as the final user turn.
    expect(updated[updated.length - 1].role).toBe('user');
    // Token usage folded into the delta so it survives mergeDelta.
    expect(entryDelta.tokenUsage.totalTokens).toBe(5);
  });

  it('preserves role alternation with an assistant spacer when the last turn is a user turn', async () => {
    settledEntry('p1', 'findings');
    // Last turn is a user (tool_result) turn — appending another user turn
    // directly would produce two consecutive user turns (Anthropic 400).
    const state = freshState([
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x' }] },
    ]);
    await deliverOwedExploreReports(state, {});

    const updated = state.conversations[CONV_KEYS.NODE_PLAN];
    // user → assistant(spacer) → user(reports): strictly alternating.
    expect(updated.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('is a no-op when NODE_PLAN is empty (fresh entry, no explores launched)', async () => {
    settledEntry('p1', 'should not be delivered on fresh entry');
    const state = freshState([]);
    await deliverOwedExploreReports(state, {});
    expect(state.conversations[CONV_KEYS.NODE_PLAN]).toEqual([]);
  });

  it('is a no-op when nothing is owed', async () => {
    const nodePlan = [{ role: 'user', content: 'plan this' }];
    const state = freshState(nodePlan);
    const entryDelta: Record<string, any> = {};
    await deliverOwedExploreReports(state, entryDelta);
    expect(state.conversations[CONV_KEYS.NODE_PLAN]).toBe(nodePlan);
    expect(entryDelta).toEqual({});
  });
});
