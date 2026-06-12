/**
 * Per-model token attribution — regression guard.
 *
 * ANT runs different models per graph node (e.g. code job default = Opus,
 * decompose = Opus, but plan/execute = Sonnet via `createLLMClient({nodeType})`).
 * Those nodes stream through a per-node client (`llmToUse`) but never update the
 * job-level `state.deps.llm`. Before the fix, `accumulateTokenUsage` keyed the
 * per-model bucket off `state.deps.llm.modelName` (the job default), so every
 * Sonnet plan/execute token was mis-attributed to Opus and the popup's "By
 * model" breakdown showed a single Opus row.
 *
 * The fix threads the per-node model id through the `modelId` option. This locks
 * it: an explicit `modelId` buckets under THAT model; omitting it falls back to
 * the job-default client.
 */

import { describe, it, expect } from 'vitest';
import { accumulateTokenUsage, type TokenTrackingState } from '../../src/agents/common/graph/llmHelpers';

const usage = (input: number, output: number) => ({
  inputTokens: input,
  outputTokens: output,
  totalTokens: input + output,
});

function makeState(jobModel: string): TokenTrackingState {
  return { deps: { llm: { modelName: jobModel } } } as unknown as TokenTrackingState;
}

describe('per-model token attribution', () => {
  it('buckets under the explicit per-node modelId, not the job default', () => {
    const state = makeState('claude-opus-4-8');
    // plan/execute ran on Sonnet while the job default is Opus.
    accumulateTokenUsage(state, usage(100, 40), { taskLevel: false, jobLevel: true, modelId: 'claude-sonnet-4-6' });

    expect(Object.keys(state.tokenUsageByModel ?? {})).toEqual(['claude-sonnet-4-6']);
    expect(state.tokenUsageByModel?.['claude-sonnet-4-6']).toMatchObject({ inputTokens: 100, outputTokens: 40 });
    expect(state.tokenUsageByModel?.['claude-opus-4-8']).toBeUndefined();
  });

  it('falls back to the job-default model when no modelId is supplied', () => {
    const state = makeState('claude-opus-4-8');
    accumulateTokenUsage(state, usage(10, 5), { taskLevel: false, jobLevel: true });

    expect(state.tokenUsageByModel?.['claude-opus-4-8']).toMatchObject({ inputTokens: 10, outputTokens: 5 });
  });

  it('keeps separate buckets per model across a mixed-model job', () => {
    const state = makeState('claude-opus-4-8');
    // decompose on the job default (Opus), plan + execute on Sonnet.
    accumulateTokenUsage(state, usage(50, 20), { taskLevel: false, jobLevel: true }); // decompose → opus fallback
    accumulateTokenUsage(state, usage(200, 80), { taskLevel: false, jobLevel: true, modelId: 'claude-sonnet-4-6' }); // plan
    accumulateTokenUsage(state, usage(300, 120), { taskLevel: false, jobLevel: true, modelId: 'claude-sonnet-4-6' }); // execute

    expect(state.tokenUsageByModel?.['claude-opus-4-8']).toMatchObject({ inputTokens: 50, outputTokens: 20, callCount: 1 });
    expect(state.tokenUsageByModel?.['claude-sonnet-4-6']).toMatchObject({ inputTokens: 500, outputTokens: 200, callCount: 2 });
  });
});
