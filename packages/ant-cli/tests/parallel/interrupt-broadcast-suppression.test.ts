/**
 * Regression — `TaskOrchestrator.broadcastKanban` MUST be a no-op once the
 * orchestrator is interrupted (`hasInterruptedTasks === true`).
 *
 * Bug (job `sharded-wand`): after a job is stopped/interrupted, the child's
 * orchestrator kept emitting `dataSource:'live'` Kanban broadcasts — the
 * `handleInterruption` emit plus every worker wind-down emit — each showing
 * the still-running tasks in `inProgress`. These LIVE broadcasts raced the
 * API-server's authoritative session-mode final broadcast (which projects
 * every in-flight task to `todo` with `interrupted:true`); whichever landed
 * last won, so the board frequently flipped back to "in-progress".
 *
 * The fix suppresses ALL further LIVE broadcasts the moment interruption
 * begins. This guards that single seam directly: the broadcast callback is
 * invoked on a normal broadcast but skipped once `hasInterruptedTasks` is set.
 * Applies to both code and design parallel jobs (shared TaskOrchestrator).
 */

import { describe, it, expect, vi } from 'vitest';
import { TaskOrchestrator } from '../../src/agents/architect/graph/code/parallel/TaskOrchestrator';
import { TaskQueue } from '../../src/agents/architect/types/task';
import type { CodeTask } from '../../src/agents/architect/types/task';

function makeOrchestrator(onKanbanUpdate: ReturnType<typeof vi.fn>) {
  const queue = new TaskQueue<CodeTask>();
  // graphBuilder is never invoked (no workers spawned in this test).
  const graphBuilder = (() => ({})) as any;
  return new TaskOrchestrator<CodeTask>(
    queue,
    graphBuilder,
    {},
    { onKanbanUpdate },
    { checkpointInterval: 0 },
  );
}

describe('TaskOrchestrator.broadcastKanban — interruption suppression (sharded-wand regression)', () => {
  it('emits a broadcast during normal run', () => {
    const onKanbanUpdate = vi.fn();
    const orch = makeOrchestrator(onKanbanUpdate);

    // Private method — invoked directly to isolate the guard from worker setup.
    (orch as any).broadcastKanban();

    expect(onKanbanUpdate).toHaveBeenCalledTimes(1);
  });

  it('suppresses the broadcast once hasInterruptedTasks is set', () => {
    const onKanbanUpdate = vi.fn();
    const orch = makeOrchestrator(onKanbanUpdate);

    (orch as any).hasInterruptedTasks = true;
    (orch as any).broadcastKanban();

    expect(onKanbanUpdate).not.toHaveBeenCalled();
  });
});
