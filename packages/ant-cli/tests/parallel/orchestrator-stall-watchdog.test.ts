/**
 * Orchestrator stall watchdog — `sandy-loading-coral` defence-in-depth.
 *
 * A worker whose in-flight LLM attempt wedges produces no usage heartbeat.
 * The watchdog (riding the checkpoint tick) must: warn once past stallWarnMs,
 * sever registered stream attempts past stallAbortMs (failure then flows via
 * the worker's own catch → reportFailure), reset the clock after an abort so
 * it never re-fires every tick, and clear on heartbeat / task exit.
 */

import { describe, it, expect, vi } from 'vitest';
import type { BaseTask } from '@ant/shared';
import { TaskQueue } from '../../src/agents/architect/types/task';
import { TaskOrchestrator } from '../../src/agents/architect/graph/code/parallel/TaskOrchestrator';
import { registerStreamAttempt, abortWorkerStreamAttempts } from '../../src/core/parallel/streamAttemptRegistry';
import { runInWorkerScope } from '../../src/core/parallel/workerScope';

type ProbeTask = BaseTask & { type: 'doc' };

function makeTask(id: string): ProbeTask {
  return { id, name: id, type: 'doc', description: id, priority: 100, completed: false } as ProbeTask;
}

function makeOrchestrator(opts: {
  stallWarnMs: number;
  stallAbortMs: number;
  onStallWarning?: (task: ProbeTask, idleMs: number, workerId: number) => void;
}): TaskOrchestrator<ProbeTask> {
  return new TaskOrchestrator<ProbeTask>(
    new TaskQueue<ProbeTask>(),
    (() => { throw new Error('graphBuilder unused'); }) as any,
    {},
    { onStallWarning: opts.onStallWarning },
    { maxWorkers: 1, checkpointInterval: 0, stallWarnMs: opts.stallWarnMs, stallAbortMs: opts.stallAbortMs },
  );
}

function seedRunning(orch: TaskOrchestrator<ProbeTask>, workerId: number, task: ProbeTask, lastProgressAt: number): void {
  (orch as any).runningTasks.set(workerId, task);
  (orch as any).lastProgressAt.set(workerId, lastProgressAt);
}

describe('TaskOrchestrator stall watchdog', () => {
  it('warns once past stallWarnMs and dedups across ticks', () => {
    const onStallWarning = vi.fn();
    const orch = makeOrchestrator({ stallWarnMs: 1000, stallAbortMs: 60_000, onStallWarning });
    seedRunning(orch, 3, makeTask('t1'), Date.now() - 5000);

    (orch as any).detectStalledWorkers();
    (orch as any).detectStalledWorkers();

    expect(onStallWarning).toHaveBeenCalledTimes(1);
    const [task, idleMs, workerId] = onStallWarning.mock.calls[0];
    expect(task.id).toBe('t1');
    expect(idleMs).toBeGreaterThanOrEqual(1000);
    expect(workerId).toBe(3);
  });

  it('past stallAbortMs severs the worker\'s registered stream attempt and resets the clock', async () => {
    const orch = makeOrchestrator({ stallWarnMs: 500, stallAbortMs: 1000 });
    seedRunning(orch, 3, makeTask('t1'), Date.now() - 5000);

    const controller = new AbortController();
    let unregister: () => void = () => {};
    await runInWorkerScope(3, async () => {
      unregister = registerStreamAttempt(controller);
    });

    (orch as any).detectStalledWorkers();
    expect(controller.signal.aborted).toBe(true);

    // Clock reset — the very next tick must NOT re-abort.
    const second = new AbortController();
    await runInWorkerScope(3, async () => {
      unregister();
      unregister = registerStreamAttempt(second);
    });
    (orch as any).detectStalledWorkers();
    expect(second.signal.aborted).toBe(false);
    unregister();
  });

  it('a usage heartbeat clears the stall state', () => {
    const onStallWarning = vi.fn();
    const orch = makeOrchestrator({ stallWarnMs: 1000, stallAbortMs: 60_000, onStallWarning });
    seedRunning(orch, 3, makeTask('t1'), Date.now() - 5000);

    (orch as any).detectStalledWorkers();
    expect(onStallWarning).toHaveBeenCalledTimes(1);

    // Heartbeat resets the clock AND the warn dedup.
    orch.reportInProgressTokenUsage(3, undefined);
    (orch as any).detectStalledWorkers();
    expect(onStallWarning).toHaveBeenCalledTimes(1);

    // Stalls again later → a fresh warn fires.
    (orch as any).lastProgressAt.set(3, Date.now() - 5000);
    (orch as any).detectStalledWorkers();
    expect(onStallWarning).toHaveBeenCalledTimes(2);
  });

  it('registry abort with no registered attempt reports zero (observe-only path)', () => {
    expect(abortWorkerStreamAttempts(99, new Error('nothing here'))).toBe(0);
  });
});
