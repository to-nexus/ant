/**
 * Recursion-limit drain regression — `noble-coating-lathe` guard (Plan A).
 *
 * When a worker's task throws a LangGraph `Recursion limit of N reached`
 * error, the orchestrator MUST:
 *
 *   1. Record the task in `failedTasks` (permanent-failure semantics).
 *   2. Set `hasInterruptedTasks=true` + `interruptReason='recursion_limit'`.
 *   3. Drain — no new task dispatch (`draining=true`). Running workers
 *      finish their current task and exit; subsequent `requestTask()` calls
 *      return `null`.
 *   4. Fire `onInterruption('recursion_limit', [failingTaskId])` exactly once.
 *   5. NOT call `signalWorkersToStop()` — other workers' in-flight tasks
 *      are unrelated to the recursion loop and their data must be preserved
 *      (parity with the permanent-failure path).
 *
 * Pre-fix regression signature (15508af5 …): the handler removed
 * `taskQueue.unshift(task)` + `spawnAvailableWorkers()` but never set
 * `draining=true`. Other spawn sites (reportCompletion, reportStopped, run
 * loop's worker-respawn guard) kept dispatching, so the failed task got
 * the "interrupted" marker but the orchestrator continued draining the
 * queue silently — confusing FE (which trusts `canResume:true` to mean
 * "no more work happening").
 */

import { describe, it, expect, vi } from 'vitest';
import type { BaseTask } from '@ant/shared';
import { TaskOrchestrator } from '../../src/agents/architect/graph/code/parallel/TaskOrchestrator';
import { TaskQueue } from '../../src/agents/architect/types/task';

interface ProbeTask extends BaseTask {
  type: 'feature';
}

function makeTask(id: string, priority: number, parallelGroup?: string): ProbeTask {
  return {
    id,
    name: id,
    type: 'feature',
    priority,
    description: 'probe task',
    exclusive: false,
    ...(parallelGroup ? { parallelGroup } : {}),
  } as ProbeTask;
}

describe('TaskOrchestrator — recursion limit drain', () => {
  it('recursion error → drain triggered, remaining queue preserved, completed tasks before fail kept', async () => {
    // 10 tasks sequential (maxWorkers=1) for deterministic ordering.
    // Tasks 0-2 succeed, task 3 throws recursion limit, tasks 4-9 stay
    // queued (drain prevents dispatch).
    const failingId = 'task-3';
    const failingMessage = 'Recursion limit of 200 reached without hitting a stop condition.';

    const graphBuilder = (_includeInstallValidate: boolean) => ({
      invoke: vi.fn(async (state: any) => {
        if (state.currentTask?.id === failingId) {
          throw new Error(failingMessage);
        }
        return { ...state, _taskCompleted: true };
      }),
    });

    const queue = new TaskQueue<ProbeTask>();
    for (let i = 0; i < 10; i++) {
      queue.push(makeTask(`task-${i}`, 100 + i));
    }

    const interruptCalls: Array<{ reason: string; ids: string[] }> = [];
    const orchestrator = new TaskOrchestrator<ProbeTask>(
      queue,
      graphBuilder,
      {},
      {
        onInterruption: (reason, ids) => {
          interruptCalls.push({ reason, ids });
        },
      },
      { maxWorkers: 1, checkpointInterval: 0 },
    );

    const result = await orchestrator.run();

    // 1. Drain was triggered (post-fix invariant). Without `this.drain()`
    //    in the recursion handler, draining stays false and `drainReason`
    //    is omitted from the result.
    expect(result.drainReason).toBeDefined();
    expect(result.drainReason).toContain('Recursion limit');

    // 2. Interrupt flags propagated.
    expect(result.hasInterruptedTasks).toBe(true);
    expect(result.interruptReason).toBe('recursion_limit');

    // 3. Exactly one failed task (the recursion limit one).
    expect(result.failedTasks.length).toBe(1);
    expect(result.failedTasks[0].task.id).toBe(failingId);
    expect(result.failedTasks[0].error.message).toBe(failingMessage);

    // 4. Tasks BEFORE the failing one completed normally; tasks AFTER
    //    stay in the queue (drain prevents dispatch). Pre-fix regression
    //    drained the queue to empty silently.
    expect(result.completedTasks.length).toBe(3);
    expect(result.completedTasks.map(t => t.id)).toEqual(['task-0', 'task-1', 'task-2']);
    expect(result.remainingQueue.length).toBe(6);
    expect(result.remainingQueue.map(t => t.id)).toEqual([
      'task-4', 'task-5', 'task-6', 'task-7', 'task-8', 'task-9',
    ]);

    // 5. onInterruption fired exactly once with the failing task's id.
    //    (Per-task SSE identifier — not a policy claim that other workers
    //    keep running.)
    expect(interruptCalls.length).toBe(1);
    expect(interruptCalls[0].reason).toBe('recursion_limit');
    expect(interruptCalls[0].ids).toEqual([failingId]);
  });

  it('with concurrent workers, in-flight tasks finish normally — no signalWorkersToStop', async () => {
    // Concurrency 3, 6 tasks. Task-2 throws recursion limit. While task-2
    // is failing, task-0 and task-1 are still running and MUST finish
    // (parity with the permanent-failure handler — no signalWorkersToStop).
    // After fail, draining prevents dispatch of tasks 3, 4, 5.
    const failingId = 'task-2';

    // Resolvers for each task, so we can serialize completion ordering:
    //   - task-0 and task-1 are gated behind a "release" promise; they
    //     complete only after task-2 has failed.
    //   - This guarantees task-0 / task-1 are mid-flight when the failure
    //     happens, exercising the "running workers finish normally"
    //     branch.
    let releaseInFlight: () => void = () => {};
    const inFlightGate = new Promise<void>((resolve) => {
      releaseInFlight = resolve;
    });

    const startedTasks = new Set<string>();
    const graphBuilder = (_includeInstallValidate: boolean) => ({
      invoke: vi.fn(async (state: any) => {
        const id = state.currentTask?.id as string;
        startedTasks.add(id);

        if (id === failingId) {
          // Let in-flight peers know they can release shortly after; we
          // throw first so drain() runs while peers are mid-await.
          queueMicrotask(releaseInFlight);
          throw new Error('Recursion limit of 200 reached without hitting a stop condition.');
        }

        // task-0 / task-1: wait for the in-flight gate (released by
        // failing task) so they're observably running at fail time.
        if (id === 'task-0' || id === 'task-1') {
          await inFlightGate;
        }
        return { ...state, _taskCompleted: true };
      }),
    });

    const queue = new TaskQueue<ProbeTask>();
    // Each task gets a unique parallelGroup so spawnAvailableWorkers fans
    // out to multiple workers concurrently. Without parallelGroup, the
    // orchestrator only spawns one worker at a time regardless of
    // maxWorkers (see spawnAvailableWorkers' `!task.parallelGroup` branch).
    for (let i = 0; i < 6; i++) {
      queue.push(makeTask(`task-${i}`, 100 + i, `g-${i}`));
    }

    const orchestrator = new TaskOrchestrator<ProbeTask>(
      queue,
      graphBuilder,
      {},
      {},
      { maxWorkers: 3, checkpointInterval: 0 },
    );

    const result = await orchestrator.run();

    // Drain fired.
    expect(result.drainReason).toBeDefined();
    expect(result.hasInterruptedTasks).toBe(true);
    expect(result.interruptReason).toBe('recursion_limit');

    // task-0 and task-1 were started AND completed (no signalWorkersToStop).
    // If the handler called signalWorkersToStop(), peers would have aborted
    // before completing.
    expect(startedTasks.has('task-0')).toBe(true);
    expect(startedTasks.has('task-1')).toBe(true);
    expect(result.completedTasks.map(t => t.id).sort()).toEqual(['task-0', 'task-1']);

    // task-2 failed.
    expect(result.failedTasks.length).toBe(1);
    expect(result.failedTasks[0].task.id).toBe(failingId);

    // tasks 3, 4, 5 never started — drain prevented dispatch.
    expect(startedTasks.has('task-3')).toBe(false);
    expect(startedTasks.has('task-4')).toBe(false);
    expect(startedTasks.has('task-5')).toBe(false);
    expect(result.remainingQueue.map(t => t.id)).toEqual(['task-3', 'task-4', 'task-5']);
  });
});
