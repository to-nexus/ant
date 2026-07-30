/**
 * Interruption checkpoint carries in-flight worker usage.
 *
 * outer-blending-prism RCA: a user stop writes the definitive interruption
 * checkpoint (handleInterruption → saveCheckpoint) while workers are still
 * mid-LLM-round; their usage lived only in `runningPartialByModel`, so the
 * sealed session snapshot recorded the seed (decompose) usage only — 97k
 * recorded vs ~2.6M actually consumed across 3 workers. Billing is unaffected
 * (settles from the Redis live snapshot fed per LLM call); the durable
 * session/kanban display was silently wrong.
 *
 * Fix: saveCheckpoint records the LIVE cumulative
 * (accumulated + Σ running partials) for both the aggregate and the
 * per-model map. Properties proved here:
 *   1. The user-stop interruption checkpoint includes the seed AND the
 *      in-flight worker's partial (both maps).
 *   2. No double count after the stopped worker's fold arrives — run()'s
 *      final totals equal the checkpoint's values (fold-in == partial
 *      fold-out at the boundary).
 *   3. The normal completion checkpoint keeps the accumulator-equal value
 *      (regression guard: the fix adds partials, never re-adds folds).
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

describe('TaskOrchestrator — interruption checkpoint live usage', () => {
  it('user-stop checkpoint includes in-flight partials; stop fold does not double-count', async () => {
    const checkpoints: any[] = [];

    // Deferred gate: the worker reports an in-flight partial, then blocks
    // until the test releases it (simulating a mid-90s LLM round at stop time).
    let releaseWorker!: () => void;
    const workerGate = new Promise<void>((r) => { releaseWorker = r; });
    let reported!: Promise<void>;
    let markReported!: () => void;
    reported = new Promise<void>((r) => { markReported = r; });

    const inFlight = { 'glm-5.2': { ...usage(500_000, 3_000), callCount: 20 } };

    const graphBuilder = (_i: boolean) => ({
      invoke: vi.fn(async (state: any) => {
        state.deps.reportInProgressTokenUsage(state.currentTask.id, usage(500_000, 3_000), inFlight);
        markReported();
        await workerGate;
        // user stop path: graph returns not-completed with the same usage as
        // its final delta (fold-in equals the last reported partial).
        return {
          ...state,
          _taskCompleted: false,
          _currentTaskTokenUsage: usage(500_000, 3_000),
          _currentTaskTokenUsageByModel: inFlight,
        };
      }),
    });

    const queue = new TaskQueue<ProbeTask>();
    queue.push(makeTask('t1'));

    const orchestrator = new TaskOrchestrator<ProbeTask>(
      queue,
      graphBuilder,
      { deps: {} },
      { onCheckpoint: async (cp: any) => { checkpoints.push(structuredClone(cp)); } },
      { maxWorkers: 1, checkpointInterval: 0 },
      [],
      usage(90_371, 6_893),                                   // seed aggregate (decompose)
      { 'glm-5.2': { ...usage(90_371, 6_893), callCount: 1 } }, // seed per-model
    );

    const runPromise = orchestrator.run();
    await reported;

    await orchestrator.handleInterruption('user_stopped');

    // (1) The interruption checkpoint carries seed + in-flight partial.
    const stopCp = checkpoints.find((c) => c.interruption?.reason === 'user_stopped');
    expect(stopCp).toBeDefined();
    expect(stopCp.tokenUsage.inputTokens).toBe(90_371 + 500_000);
    expect(stopCp.tokenUsageByModel['glm-5.2'].inputTokens).toBe(90_371 + 500_000);
    expect(stopCp.tokenUsageByModel['glm-5.2'].callCount).toBe(21);

    // (2) Release the worker: its reportStopped fold must land on the SAME
    // totals (partial fold-out == fold-in), not double.
    releaseWorker();
    const result = await runPromise;
    expect(result.tokenUsage.inputTokens).toBe(90_371 + 500_000);
    expect(result.tokenUsageByModel).toBeDefined();
    const foldedByModel = result.tokenUsageByModel!;
    expect(foldedByModel['glm-5.2'].inputTokens).toBe(90_371 + 500_000);
    expect(foldedByModel['glm-5.2'].callCount).toBe(21);
  });

  it('normal completion checkpoint equals the accumulator (no partial re-add)', async () => {
    const checkpoints: any[] = [];
    const delta = { 'claude-sonnet-5': { ...usage(300, 4), callCount: 5 } };

    const graphBuilder = (_i: boolean) => ({
      invoke: vi.fn(async (state: any) => {
        state.deps.reportInProgressTokenUsage(state.currentTask.id, usage(300, 4), delta);
        return {
          ...state,
          _taskCompleted: true,
          _currentTaskTokenUsage: usage(300, 4),
          _currentTaskTokenUsageByModel: delta,
        };
      }),
    });

    const queue = new TaskQueue<ProbeTask>();
    queue.push(makeTask('t1'));

    const orchestrator = new TaskOrchestrator<ProbeTask>(
      queue,
      graphBuilder,
      { deps: {} },
      { onCheckpoint: async (cp: any) => { checkpoints.push(structuredClone(cp)); } },
      { maxWorkers: 1, checkpointInterval: 0 },
      [],
      usage(147, 15),
      { 'claude-opus-5': { ...usage(147, 15), callCount: 1 } },
    );

    const result = await orchestrator.run();

    // Pin the premise: an absent per-model map should fail as an assertion here,
    // not as an opaque TypeError at the first index below.
    expect(result.tokenUsageByModel).toBeDefined();
    const byModel = result.tokenUsageByModel!;

    // Last checkpoint (post-completion): partial already folded + deleted —
    // the live cumulative equals the accumulator, no growth from the fix.
    const last = checkpoints[checkpoints.length - 1];
    expect(last.tokenUsage.inputTokens).toBe(147 + 300);
    expect(result.tokenUsage.inputTokens).toBe(147 + 300);
    expect(last.tokenUsageByModel['claude-sonnet-5'].inputTokens).toBe(300);
  });
});
