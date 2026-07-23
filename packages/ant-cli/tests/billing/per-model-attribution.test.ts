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
import {
  accumulateTokenUsage,
  resetTaskTokenUsage,
  rollUpTaskUsageToJob,
  type TokenTrackingState,
} from '../../src/agents/common/graph/llmHelpers';

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
    accumulateTokenUsage(state, usage(100, 40), { taskLevel: false, jobLevel: true, modelId: 'claude-sonnet-5' });

    expect(Object.keys(state.tokenUsageByModel ?? {})).toEqual(['claude-sonnet-5']);
    expect(state.tokenUsageByModel?.['claude-sonnet-5']).toMatchObject({ inputTokens: 100, outputTokens: 40 });
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
    accumulateTokenUsage(state, usage(200, 80), { taskLevel: false, jobLevel: true, modelId: 'claude-sonnet-5' }); // plan
    accumulateTokenUsage(state, usage(300, 120), { taskLevel: false, jobLevel: true, modelId: 'claude-sonnet-5' }); // execute

    expect(state.tokenUsageByModel?.['claude-opus-4-8']).toMatchObject({ inputTokens: 50, outputTokens: 20, callCount: 1 });
    expect(state.tokenUsageByModel?.['claude-sonnet-5']).toMatchObject({ inputTokens: 500, outputTokens: 200, callCount: 2 });
  });
});

/**
 * Per-task per-model delta symmetry — the parallel-executor billing fix.
 *
 * The aggregate `tokenUsage` is robust because it uses a reset-per-task counter
 * (`_currentTaskTokenUsage`) reported as a clean delta and summed by the
 * orchestrator. The per-model map now has the exact same twin
 * (`_currentTaskTokenUsageByModel`) so `Σ(per-task per-model deltas)` equals the
 * job-level per-model map. Without this, the parallel executor under-attributed
 * per-model cost ~55× (a single task's worth).
 */
describe('per-task per-model delta symmetry', () => {
  it('taskLevel write populates the per-task per-model twin with the right model', () => {
    const state = makeState('claude-opus-4-8');
    accumulateTokenUsage(state, usage(200, 80), { taskLevel: true, jobLevel: false, modelId: 'deepseek-v4-pro' });
    expect(state._currentTaskTokenUsageByModel?.['deepseek-v4-pro']).toMatchObject({ inputTokens: 200, outputTokens: 80 });
  });

  it('resetTaskTokenUsage clears the per-task per-model twin (per-task deltas)', () => {
    const state = makeState('claude-opus-4-8');
    accumulateTokenUsage(state, usage(200, 80), { taskLevel: true, jobLevel: false, modelId: 'deepseek-v4-pro' });
    resetTaskTokenUsage(state);
    expect(state._currentTaskTokenUsageByModel).toEqual({});
  });

  it('sum of per-task per-model deltas equals the job-level per-model map', () => {
    // Simulate a mixed-model job: opus decompose (job-level), then two deepseek
    // tasks each accumulating task-level, rolled up to job-level per task.
    const state = makeState('claude-opus-4-8');

    // decompose (estimating): job-level only, opus.
    accumulateTokenUsage(state, usage(147, 15), { taskLevel: false, jobLevel: true });

    const deltas: Record<string, { input: number; output: number }> = {};
    for (const [inTok, outTok] of [[300, 4], [250, 6]] as const) {
      resetTaskTokenUsage(state);
      accumulateTokenUsage(state, usage(inTok, outTok), { taskLevel: true, jobLevel: false, modelId: 'deepseek-v4-pro' });
      // capture the per-task delta then roll it up (mirrors the design-job path)
      const d = state._currentTaskTokenUsageByModel!['deepseek-v4-pro'];
      deltas['deepseek-v4-pro'] = {
        input: (deltas['deepseek-v4-pro']?.input ?? 0) + d.inputTokens,
        output: (deltas['deepseek-v4-pro']?.output ?? 0) + d.outputTokens,
      };
      rollUpTaskUsageToJob(state);
    }

    // Job-level per-model map: opus from decompose + deepseek from rolled-up deltas.
    expect(state.tokenUsageByModel?.['claude-opus-4-8']).toMatchObject({ inputTokens: 147, outputTokens: 15 });
    expect(state.tokenUsageByModel?.['deepseek-v4-pro']).toMatchObject({
      inputTokens: deltas['deepseek-v4-pro'].input,
      outputTokens: deltas['deepseek-v4-pro'].output,
    });
    // 300+250 = 550 input, 4+6 = 10 output.
    expect(state.tokenUsageByModel?.['deepseek-v4-pro']?.inputTokens).toBe(550);
    expect(state.tokenUsageByModel?.['deepseek-v4-pro']?.outputTokens).toBe(10);
  });
});
