/**
 * Orchestrator barrier — `such-pinning-milky` post-UI cleanup regression guard.
 *
 * Reproduces the May 21 2026 deadlock where decompose intentionally queued
 * a `type='feature', exclusive=true` post-UI cleanup task AFTER all UI
 * tasks. The pre-fix `computeBarriers` predicate read
 *
 *   hasPreUiWork = running.some(blocksUi) || queued.some(blocksUi)
 *
 * so the queued cleanup-feature kept `hasPreUiWork=true` even though it
 * sat positionally BEHIND the UI tasks. The head UI task hit `break` at
 * the preUiBarrier site, requestTask returned null, all workers
 * terminated, the spawn-respawn guard re-spawned them immediately, and
 * the loop spun 3700+ times until stderr backpressure forced an exit.
 *
 * Fix (Option A): drop `queued.some(...)` from every barrier. Queue
 * order itself enforces dependency order — when decompose places
 * prerequisites earlier, they dispatch first and `running.some(blocker)`
 * catches the barrier. When decompose intentionally places a producer
 * (cleanup feature) later, the queue order signals "this is post-UI work"
 * and the barrier correctly stays off until the producer actually runs.
 *
 * This test guards three invariants:
 *   C1 — post-UI cleanup feature queued behind UI tasks does NOT deadlock.
 *   C2 — foundation->ui ordering is still enforced via `running.some()`.
 *   C3 — pre-UI feature at queue head dispatches and then blocks UI via
 *        `running.some()` while it runs.
 */

import { describe, it, expect, vi } from 'vitest';
import type { BaseTask } from '@ant/shared';
import { TaskOrchestrator } from '../../src/agents/architect/graph/code/parallel/TaskOrchestrator';
import { TaskQueue } from '../../src/agents/architect/types/task';
import type { CodeTask } from '../../src/agents/architect/types/task';

function uiTask(id: string, priority: number, parallelGroup: string): CodeTask {
  return {
    id,
    name: id,
    type: 'ui',
    priority,
    description: '',
    parallelGroup,
    exclusive: false,
  } as CodeTask;
}

function featureTask(
  id: string,
  priority: number,
  opts: { exclusive?: boolean; band?: 'foundation' | 'integration' } = {},
): CodeTask {
  return {
    id,
    name: id,
    type: 'feature',
    priority,
    description: '',
    exclusive: opts.exclusive ?? false,
    ...(opts.band ? { band: opts.band } : {}),
  } as CodeTask;
}

function verificationTask(id: string, priority: number): CodeTask {
  return {
    id,
    name: id,
    type: 'verification',
    priority,
    description: '',
    exclusive: true,
  } as CodeTask;
}

/**
 * Build a graph mock whose `invoke` returns the success terminal state
 * the worker subgraph normally produces. The worker treats this as a
 * completed task and reports back via `reportCompletion`.
 */
function passingGraphBuilder() {
  return (_includeInstallValidate: boolean) => ({
    invoke: vi.fn(async (state: any) => ({ ...state, _taskCompleted: true })),
  });
}

describe('TaskOrchestrator — post-UI cleanup feature does not deadlock', () => {
  it('C1: 9 ui tasks + 1 cleanup feature(exclusive, priority>UI) drains cleanly', async () => {
    // Reproduces the exact `such-pinning-milky` queue shape.
    const queue = new TaskQueue<CodeTask>();
    for (let i = 0; i < 9; i++) {
      queue.push(uiTask(`ui-${i}`, 650 + i, `case-${i}`));
    }
    queue.push(featureTask('cleanup-purge', 900, { exclusive: true }));
    queue.push(verificationTask('final-verification', 1000));

    let observedNullWithNonEmpty = false;

    const orchestrator = new TaskOrchestrator<CodeTask>(
      queue,
      passingGraphBuilder(),
      {},
      {
        // Detect the deadlock signature defensively — if requestTask
        // returned null repeatedly with non-empty queue + zero running,
        // the test would hang at orchestrator.run() so we'd never reach
        // this assertion. Adding the flag mostly documents intent.
        onWorkerTerminate: () => {
          // no-op; orchestrator handles its own respawn
        },
      },
      { maxWorkers: 3, checkpointInterval: 0, barriers: { feature: true, ui: true } },
    );

    const result = await Promise.race([
      orchestrator.run(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('orchestrator hung — deadlock regression')), 5000),
      ),
    ]);

    expect(observedNullWithNonEmpty).toBe(false);
    expect(result.completedTasks.length).toBe(11);
    expect(result.failedTasks.length).toBe(0);
    expect(result.remainingQueue.length).toBe(0);

    // Order invariant: cleanup-purge dispatched after all UI tasks complete
    // (because at that moment `running.some(blocksUi)` is finally false and
    // exclusive fast-path picks the head). final-verification last.
    const ids = result.completedTasks.map((t) => t.id);
    const cleanupIdx = ids.indexOf('cleanup-purge');
    const verifyIdx = ids.indexOf('final-verification');
    expect(cleanupIdx).toBeGreaterThan(-1);
    expect(verifyIdx).toBe(ids.length - 1);
    for (let i = 0; i < 9; i++) {
      expect(ids.indexOf(`ui-${i}`)).toBeLessThan(cleanupIdx);
    }
  });

  it('C2: foundation running ⇒ ui tasks still blocked by running.some(blocksUi)', async () => {
    // Foundation feature task is slow; concurrent UI tasks must NOT
    // dispatch in parallel with it. This is the "skeleton → UI" intent
    // that the original barrier was meant to enforce — Option A preserves
    // it via `running.some()`.
    const queue = new TaskQueue<CodeTask>();
    queue.push(featureTask('foundation-A', 200, { band: 'foundation' }));
    queue.push(uiTask('ui-0', 650, 'case-0'));
    queue.push(uiTask('ui-1', 651, 'case-1'));
    queue.push(uiTask('ui-2', 652, 'case-2'));

    const startOrder: string[] = [];
    const completeOrder: string[] = [];
    let foundationStartedAt = -1;
    let firstUiStartedAt = -1;

    const builder = (_includeInstallValidate: boolean) => ({
      invoke: vi.fn(async (state: any) => {
        const id = state.currentTask?.id as string;
        const idx = startOrder.length;
        startOrder.push(id);
        if (id === 'foundation-A') {
          foundationStartedAt = idx;
          // Hold long enough for any concurrent UI worker to attempt dispatch.
          await new Promise((r) => setTimeout(r, 80));
        } else if (id.startsWith('ui-') && firstUiStartedAt === -1) {
          firstUiStartedAt = idx;
        }
        completeOrder.push(id);
        return { ...state, _taskCompleted: true };
      }),
    });

    const orchestrator = new TaskOrchestrator<CodeTask>(
      queue,
      builder,
      {},
      {},
      { maxWorkers: 3, checkpointInterval: 0, barriers: { feature: true, ui: true } },
    );

    const result = await orchestrator.run();

    expect(result.completedTasks.length).toBe(4);
    expect(result.failedTasks.length).toBe(0);

    // foundation-A must have STARTED before any UI task started — barrier
    // enforced via running.some(isFoundationTask) during foundation-A's
    // 80ms invoke window.
    expect(foundationStartedAt).toBe(0);
    expect(firstUiStartedAt).toBeGreaterThanOrEqual(1);

    // foundation-A must have COMPLETED before any UI task completed.
    const foundationCompleteIdx = completeOrder.indexOf('foundation-A');
    for (let i = 0; i < 3; i++) {
      expect(completeOrder.indexOf(`ui-${i}`)).toBeGreaterThan(foundationCompleteIdx);
    }
  });

  it('C3: pre-UI feature at queue head dispatches and blocks UI while running', async () => {
    // Decompose places the producer feature BEFORE its UI consumers — the
    // common normal-flow shape. `running.some()` catches the barrier
    // while the feature is in flight; once it completes, UI dispatches.
    const queue = new TaskQueue<CodeTask>();
    queue.push(featureTask('pre-ui-feature', 500));
    queue.push(uiTask('ui-x', 650, 'case-x'));
    queue.push(uiTask('ui-y', 651, 'case-y'));

    const startTimes: Record<string, number> = {};
    const endTimes: Record<string, number> = {};

    const builder = (_includeInstallValidate: boolean) => ({
      invoke: vi.fn(async (state: any) => {
        const id = state.currentTask?.id as string;
        startTimes[id] = Date.now();
        if (id === 'pre-ui-feature') {
          await new Promise((r) => setTimeout(r, 60));
        }
        endTimes[id] = Date.now();
        return { ...state, _taskCompleted: true };
      }),
    });

    const orchestrator = new TaskOrchestrator<CodeTask>(
      queue,
      builder,
      {},
      {},
      { maxWorkers: 3, checkpointInterval: 0, barriers: { feature: true, ui: true } },
    );

    const result = await orchestrator.run();
    expect(result.completedTasks.length).toBe(3);

    // pre-ui-feature must end before any UI task starts (running.some
    // barrier holds UI back).
    expect(endTimes['pre-ui-feature']).toBeLessThanOrEqual(startTimes['ui-x']);
    expect(endTimes['pre-ui-feature']).toBeLessThanOrEqual(startTimes['ui-y']);
  });
});
