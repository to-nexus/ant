/**
 * Orchestrator LIVE per-model publication — the running-job blank-cost fix
 * (`zesty-riding-cake`).
 *
 * Before the fix, `tokenUsageByModel` (the SSOT the token-usage popup derives
 * USD + per-model rows from) was frozen at the seed during parallel execution:
 * it only grew when a task COMPLETED. So a running job showed aggregate tokens
 * but no cost / per-model breakdown until the first completion.
 *
 * The fix routes each worker's in-flight per-task per-model delta to the
 * orchestrator, which publishes the live job-cumulative map
 * (`accumulated + Σ running partials`) on every mid-task report. This test
 * proves three properties:
 *   1. BEFORE any task completes, the published cumulative already carries the
 *      seed model + the in-flight worker model, with a positive USD cost.
 *   2. The published cumulative is monotonic non-decreasing across every report
 *      AND across the completion boundary (no shrink → the broadcaster's
 *      anti-shrink guard never trips; no double count).
 *   3. The final per-model map equals seed + Σ deltas and mirrors the aggregate
 *      (conservation — unchanged from the seed test).
 */
import { describe, it, expect, vi } from 'vitest';
import type { BaseTask } from '@ant/shared';
import { computeJobCostUsd, inputSideTokens } from '@ant/shared';
import { TaskOrchestrator } from '../../src/agents/architect/graph/code/parallel/TaskOrchestrator';
import { TaskQueue } from '../../src/agents/architect/types/task';

interface ProbeTask extends BaseTask {
  type: 'feature';
}

function makeTask(id: string): ProbeTask {
  return { id, name: id, type: 'feature', priority: 100, description: 't', exclusive: false } as ProbeTask;
}

const usage = (input: number, output: number) => ({ inputTokens: input, outputTokens: output, totalTokens: input + output });

describe('TaskOrchestrator — live per-model publication (running job)', () => {
  it('publishes seed + in-flight worker model before completion, monotonic, no double count', async () => {
    // Every per-model map the orchestrator publishes, captured in temporal
    // order (single-threaded — push order == broadcast order). Two sources feed
    // it: mid-task reports via the injected reporter (kanbanUpdate.updateTokenUsageByModel)
    // and task-boundary broadcasts via onKanbanUpdate.
    const published: Record<string, any>[] = [];

    const kanbanUpdate = {
      updateTokenUsageByModel: (m: Record<string, any>) => published.push(structuredClone(m)),
      updateInProgressTaskTokenUsage: vi.fn(),
    };

    // Worker subgraph: two mid-task reports (sonnet partial grows 100 → 300)
    // BEFORE returning completion. The final delta equals the last report, so
    // the completion fold-out is exactly the fold-in (boundary stays equal).
    const graphBuilder = (_i: boolean) => ({
      invoke: vi.fn(async (state: any) => {
        const report = state.deps.reportInProgressTokenUsage;
        report(state.currentTask.id, usage(100, 2), { 'claude-sonnet-5': { ...usage(100, 2), callCount: 2 } });
        report(state.currentTask.id, usage(300, 4), { 'claude-sonnet-5': { ...usage(300, 4), callCount: 5 } });
        return {
          ...state,
          _taskCompleted: true,
          _currentTaskTokenUsage: usage(300, 4),
          _currentTaskTokenUsageByModel: { 'claude-sonnet-5': { ...usage(300, 4), callCount: 5 } },
        };
      }),
    });

    const queue = new TaskQueue<ProbeTask>();
    queue.push(makeTask('t1'));

    const orchestrator = new TaskOrchestrator<ProbeTask>(
      queue,
      graphBuilder,
      { deps: { kanbanUpdate } },                                 // sharedContext — broadcaster port
      { onKanbanUpdate: (_ct, _q, _c, _agg, byModel) => { if (byModel) published.push(structuredClone(byModel)); } },
      { maxWorkers: 1, checkpointInterval: 0 },
      [],
      usage(147, 15),                                             // seed aggregate (opus decompose)
      { 'claude-opus-4-8': { ...usage(147, 15), callCount: 1 } }, // seed per-model (opus)
    );

    const result = await orchestrator.run();

    // (1) A pre-completion publish carries BOTH the seed model and the in-flight
    // worker model, priced at a positive USD — the popup would no longer be blank.
    const liveWithBoth = published.find(
      (m) => m['claude-opus-4-8'] && m['claude-sonnet-5'],
    );
    expect(liveWithBoth).toBeDefined();
    expect(computeJobCostUsd(liveWithBoth as Record<string, any>).usd).toBeGreaterThan(0);

    // (2) Monotonic non-decreasing input-side across the whole sequence — the
    // completion boundary (delta folded in, partial deleted) stays EQUAL, never
    // shrinks and never double-counts.
    const sums = published.map((m) => inputSideTokens({
      inputTokens: Object.values(m).reduce((s: number, u: any) => s + u.inputTokens, 0),
      outputTokens: 0,
      totalTokens: 0,
      cacheReadTokens: Object.values(m).reduce((s: number, u: any) => s + (u.cacheReadTokens || 0), 0),
      cacheCreationTokens: Object.values(m).reduce((s: number, u: any) => s + (u.cacheCreationTokens || 0), 0),
    } as any));
    for (let i = 1; i < sums.length; i++) {
      expect(sums[i]).toBeGreaterThanOrEqual(sums[i - 1]);
    }

    // (3) Conservation — final per-model = seed + Σ deltas, no double count, and
    // per-model input sum mirrors the aggregate.
    expect(result.tokenUsageByModel['claude-opus-4-8']).toMatchObject({ inputTokens: 147, outputTokens: 15 });
    expect(result.tokenUsageByModel['claude-sonnet-5']).toMatchObject({ inputTokens: 300, outputTokens: 4 });
    expect(result.tokenUsage.inputTokens).toBe(447);
    const perModelInput =
      result.tokenUsageByModel['claude-opus-4-8'].inputTokens +
      result.tokenUsageByModel['claude-sonnet-5'].inputTokens;
    expect(perModelInput).toBe(result.tokenUsage.inputTokens);
  });
});
