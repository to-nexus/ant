/**
 * Orchestrator per-model seed + delta-merge invariant — the parallel-executor
 * billing fix (`slow-earning-heron` ~55× undercharge).
 *
 * Two guarantees:
 *  1. The estimating-phase (decompose, often a costlier model like opus) usage
 *     is SEEDED into the orchestrator accumulators, so it is never dropped from
 *     the per-model billing map once the orchestrator drives broadcasts.
 *  2. Each worker reports a reset-per-task per-model DELTA
 *     (`_currentTaskTokenUsageByModel`), which the orchestrator SUMS — so the
 *     final per-model map equals seed + Σ(deltas), matching the aggregate.
 */
import { describe, it, expect, vi } from 'vitest';
import type { BaseTask } from '@ant/shared';
import { TaskOrchestrator } from '../../src/agents/architect/graph/code/parallel/TaskOrchestrator';
import { TaskQueue } from '../../src/agents/architect/types/task';

type ProbeTask = Extract<BaseTask, { type: 'feature' }>;

function makeTask(id: string): ProbeTask {
  return { id, name: id, type: 'feature', priority: 100, description: 't', exclusive: false } as ProbeTask;
}

const usage = (input: number, output: number) => ({ inputTokens: input, outputTokens: output, totalTokens: input + output });

describe('TaskOrchestrator — per-model seed + delta merge', () => {
  it('seeds estimating (opus) usage and sums per-task deepseek deltas', async () => {
    // Each task returns a FIXED per-task per-model delta, as an accumulated
    // worker subgraph would (reset per task → holds only this task's usage).
    const graphBuilder = (_i: boolean) => ({
      invoke: vi.fn(async (state: any) => ({
        ...state,
        _taskCompleted: true,
        _currentTaskTokenUsage: usage(300, 4),
        _currentTaskTokenUsageByModel: { 'deepseek-v4-pro': { ...usage(300, 4), callCount: 5 } },
      })),
    });

    const queue = new TaskQueue<ProbeTask>();
    queue.push(makeTask('t1'));
    queue.push(makeTask('t2'));

    const orchestrator = new TaskOrchestrator<ProbeTask>(
      queue,
      graphBuilder,
      {},
      {},
      { maxWorkers: 1, checkpointInterval: 0 },
      [],
      usage(147, 15),                                          // seed aggregate (opus decompose)
      { 'claude-opus-5': { ...usage(147, 15), callCount: 1 } }, // seed per-model (opus)
    );

    const result = await orchestrator.run();

    // Pin the premise: an absent per-model map should fail as an assertion here,
    // not as an opaque TypeError at the first index below.
    expect(result.tokenUsageByModel).toBeDefined();
    const byModel = result.tokenUsageByModel!;

    // Opus (seed) survives, deepseek deltas sum: 300*2 input, 4*2 output.
    expect(byModel['claude-opus-5']).toMatchObject({ inputTokens: 147, outputTokens: 15 });
    expect(byModel['deepseek-v4-pro']).toMatchObject({ inputTokens: 600, outputTokens: 8 });

    // Aggregate mirrors: seed 147 + 2*300 = 747 input.
    expect(result.tokenUsage.inputTokens).toBe(747);
    expect(result.tokenUsage.outputTokens).toBe(23);

    // Per-model input sum equals the aggregate input (conservation invariant).
    const perModelInput =
      byModel['claude-opus-5'].inputTokens +
      byModel['deepseek-v4-pro'].inputTokens;
    expect(perModelInput).toBe(result.tokenUsage.inputTokens);
  });
});
