/**
 * P0 — parallel workers receive cross-job `featureContext`
 * (e2-humming-spindle RCA).
 *
 * Before the fix, `parallelOrchestrator`'s `sharedContext` literal in BOTH
 * `code/graph.ts` and `design/graph.ts` omitted `featureContext`, while the
 * worker subgraphs declare the channel (spread of `CodeGraphChannels` /
 * `DesignGraphChannels`) and the worker plan prompts render
 * `featureContext.*` blocks. Result: every Tier 3 worker plan prompt
 * rendered an EMPTY Prior Context section while the serial path rendered it
 * — a silent cross-job amnesia that only manifests when
 * ANT_TASK_CONCURRENCY > 1.
 *
 * Two locks:
 *  1. behavioral — TaskWorker propagates a `featureContext` key from
 *     sharedContext into every workerState it builds.
 *  2. static — the sharedContext literals in both graph files keep passing
 *     `featureContext: state.featureContext` (the omission was in a private
 *     function's object literal, unreachable by a cheap unit test).
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BaseTask } from '@ant/shared';
import { TaskOrchestrator } from '../../src/agents/architect/graph/code/parallel/TaskOrchestrator';
import { TaskQueue } from '../../src/agents/architect/types/task';

interface ProbeTask extends BaseTask {
  type: 'feature';
}

const SRC_ROOT = join(__dirname, '../../src/agents/architect/graph');

function sharedContextBlockOf(graphFile: string): string {
  const source = readFileSync(join(SRC_ROOT, graphFile), 'utf8');
  const start = source.indexOf('const sharedContext = {');
  expect(start, `${graphFile}: sharedContext literal not found`).toBeGreaterThan(-1);
  // The literal ends at the first `};` after its start — good enough for a lock.
  const end = source.indexOf('};', start);
  return source.slice(start, end);
}

describe('parallel workers — featureContext propagation (P0)', () => {
  it('TaskWorker passes sharedContext.featureContext into every workerState', async () => {
    const seen: any[] = [];
    const graphBuilder = () => ({
      invoke: vi.fn(async (state: any) => {
        seen.push({ task: state.currentTask?.name, featureContext: state.featureContext });
        return { ...state, _taskCompleted: true };
      }),
    });

    const queue = new TaskQueue<ProbeTask>();
    queue.push({
      id: 't1', name: 'feature-1', type: 'feature', priority: 100,
      description: 'probe', exclusive: false,
    } as ProbeTask);

    const featureContext = {
      userTurns: [{ text: 'prior directive' }],
      breadcrumbs: [{ summary: 'prior artifact', anchors: { files: ['a.md'] } }],
    };

    const orchestrator = new TaskOrchestrator<ProbeTask>(
      queue,
      graphBuilder,
      { featureContext },
      {},
      { maxWorkers: 1, checkpointInterval: 0 },
    );
    await orchestrator.run();

    expect(seen).toHaveLength(1);
    expect(seen[0].featureContext).toEqual(featureContext);
  });

  it('code graph sharedContext literal carries featureContext', () => {
    expect(sharedContextBlockOf('code/graph.ts')).toContain('featureContext: state.featureContext');
  });

  it('design graph sharedContext literal carries featureContext', () => {
    expect(sharedContextBlockOf('design/graph.ts')).toContain('featureContext: state.featureContext');
  });
});
