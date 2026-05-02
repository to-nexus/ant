/**
 * L1 — `TaskWorker` propagates orchestrator's `completedTasksDetails`
 * onto every workerState (vast-curling-perch follow-up).
 *
 * Before the fix, `sharedContext` (captured at orchestrator init time)
 * never carried `completedTasksDetails`, so a verification cycle that
 * popped after sibling error sub-tasks completed would still see
 * `state.completedTasksDetails === undefined`. The verify-mode plan
 * prompt's `priorErrorTasks` injection then silently rendered an empty
 * section every cycle, defeating the regression-by-repetition guard
 * (`docs/architecture/17-code-verification-task.md` §3 banner contract).
 *
 * The fix queries `this.orchestrator.getCompletedTasks()` at workerState
 * construction time so each cycle gets a stable, up-to-date snapshot.
 */

import { describe, it, expect, vi } from 'vitest';
import type { BaseTask } from '@ant/shared';
import { TaskOrchestrator } from '../../src/agents/architect/graph/code/parallel/TaskOrchestrator';
import { TaskQueue } from '../../src/agents/architect/types/task';

interface ProbeTask extends BaseTask {
  type: 'feature' | 'error' | 'verification';
}

function makeTask(overrides: Partial<ProbeTask>): ProbeTask {
  return {
    id: 'task',
    name: 'task',
    type: 'feature',
    priority: 100,
    description: 'test task',
    exclusive: false,
    ...overrides,
  } as ProbeTask;
}

describe('TaskWorker — completedTasksDetails propagation', () => {
  it('every workerState carries the orchestrator\'s up-to-date completed list (live snapshot, not the empty sharedContext default)', async () => {
    // The graph builder records every workerState it sees so we can
    // assert what each successive task observed when its plan node ran.
    const seenStates: any[] = [];
    const graphBuilder = (_includeInstallValidate: boolean) => ({
      invoke: vi.fn(async (state: any) => {
        seenStates.push({
          taskName: state.currentTask?.name,
          completed: (state.completedTasksDetails ?? []).map((t: any) => t.name),
        });
        return { ...state, _taskCompleted: true };
      }),
    });

    const queue = new TaskQueue<ProbeTask>();
    queue.push(makeTask({ id: 'e1', name: 'error-1', type: 'error', priority: 998 }));
    queue.push(makeTask({ id: 'e2', name: 'error-2', type: 'error', priority: 999 }));
    queue.push(makeTask({ id: 'v1', name: 'verification', type: 'verification', priority: 1000, exclusive: true }));

    const orchestrator = new TaskOrchestrator<ProbeTask>(
      queue,
      graphBuilder,
      { /* sharedContext intentionally empty — no completedTasksDetails */ },
      {},
      { maxWorkers: 1, checkpointInterval: 0 },
    );

    await orchestrator.run();

    // 3 tasks executed in priority order: error-1, error-2, verification.
    expect(seenStates.map(s => s.taskName)).toEqual(['error-1', 'error-2', 'verification']);

    // error-1 saw zero completed (it was first).
    expect(seenStates[0].completed).toEqual([]);

    // error-2 saw the previously-completed error-1.
    expect(seenStates[1].completed).toEqual(['error-1']);

    // verification (the regression-critical case) MUST see both prior
    // error sub-tasks. Without the live propagation it would have been [].
    expect(seenStates[2].completed).toEqual(['error-1', 'error-2']);
  });
});
