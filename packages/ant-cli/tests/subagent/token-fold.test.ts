/**
 * foldSubagentUsage — per-model attribution lands on tokenUsageByModel /
 * _currentTaskTokenUsageByModel; currentPhaseTokenUsage untouched; returned
 * delta only names channels the state declares (unreturned-channel-drop /
 * unknown-channel guard); two-model fold stays attributed (slow-earning-heron
 * class guard).
 */

import { describe, it, expect } from 'vitest';
import { foldSubagentUsage } from '../../src/agents/common/subagent/tokens';
import type { SubagentEntry } from '../../src/agents/common/subagent/types';

function entryWithUsage(id: string, modelId: string, input: number, output: number): SubagentEntry {
  return {
    id, ownerKey: 'o', goal: 'g', status: 'settled',
    promise: Promise.resolve(), launchedAt: 0, delivered: true,
    result: {
      report: 'r', rounds: 1, state: 'done', modelId,
      usage: { inputTokens: input, outputTokens: output, totalTokens: input + output },
    },
  };
}

function freshState(): Record<string, any> {
  return {
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    tokenUsageByModel: {},
    _currentTaskTokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    _currentTaskTokenUsageByModel: {},
    deps: { llm: { modelName: 'parent-model' } },
  };
}

describe('foldSubagentUsage', () => {
  it('folds per-model usage into job + task twins and returns the delta', async () => {
    const state = freshState();
    const delta = await foldSubagentUsage(state, [
      entryWithUsage('a', 'child-model-1', 100, 50),
      entryWithUsage('b', 'child-model-2', 10, 5),
    ]);

    expect(state.tokenUsage.totalTokens).toBe(165);
    expect(state.tokenUsageByModel['child-model-1'].totalTokens).toBe(150);
    expect(state.tokenUsageByModel['child-model-2'].totalTokens).toBe(15);
    // Parent model bucket untouched — attribution stays on the child model.
    expect(state.tokenUsageByModel['parent-model']).toBeUndefined();

    // Explicit channel delta present for every declared channel.
    expect(delta.tokenUsage).toBe(state.tokenUsage);
    expect(delta.tokenUsageByModel).toBe(state.tokenUsageByModel);
    expect(delta._currentTaskTokenUsage).toBe(state._currentTaskTokenUsage);
    expect(delta._currentTaskTokenUsageByModel).toBe(state._currentTaskTokenUsageByModel);

    // The child is a separate conversation: never write the parent gauge.
    expect(delta.currentPhaseTokenUsage).toBeUndefined();
    expect(state.currentPhaseTokenUsage).toBeUndefined();
  });

  it('omits channels the graph does not declare (unknown-channel guard)', async () => {
    // planner/ask-shaped state: no _currentTask* channels.
    const state: Record<string, any> = {
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      tokenUsageByModel: {},
      deps: { llm: { modelName: 'parent-model' } },
    };
    const delta = await foldSubagentUsage(state, [entryWithUsage('a', 'child-model', 5, 5)]);
    expect(delta.tokenUsage).toBeDefined();
    expect(delta.tokenUsageByModel).toBeDefined();
    expect('_currentTaskTokenUsage' in delta).toBe(false);
    expect('_currentTaskTokenUsageByModel' in delta).toBe(false);
  });

  it('no-usage entries fold to an empty delta', async () => {
    const state = freshState();
    const entry = entryWithUsage('a', 'm', 1, 1);
    delete (entry.result as any).usage;
    const delta = await foldSubagentUsage(state, [entry]);
    expect(Object.keys(delta)).toHaveLength(0);
    expect(state.tokenUsage.totalTokens).toBe(0);
  });
});
