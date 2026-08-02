/**
 * Axis: design-job `doc` stage bands under `barriers: { assets, spec }`.
 *
 * The handoff decompose contract moves component specimen pages from the shared
 * layer (200–249) to the consumer stage (300–349) so a specimen is authored
 * AFTER the `components/<name>.css` whose class names it composes. That fix is
 * pure prompt text — it rides on the claim that the existing barriers already
 * gate 300+ behind everything at 100–299.
 *
 * Nothing covered that claim, so this suite locks it:
 *   S1 — no 200-range task dispatches while a 100-range task runs.
 *   S2 — no 300-range task dispatches while ANY 200-range task runs.
 *   S3 — the queue drains (a barrier that never opens is a deadlock).
 *
 * `DESIGN_DOC_BANDS` classifies `doc` tasks as tokens 100–199 / assets 200–299 /
 * neither, and `computeBarriers` reads `running` only — see
 * `code/tasks/doc/hooks/scheduling.ts` and `code/parallel/TaskOrchestrator.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { TaskOrchestrator } from '../../src/agents/architect/graph/code/parallel/TaskOrchestrator';
import { TaskQueue } from '../../src/agents/architect/types/task';
import type { DesignTask } from '../../src/agents/architect/types/task';
import { classify } from '../../src/agents/architect/graph/code/tasks/doc/hooks/scheduling';

const docTask = (id: string, priority: number): DesignTask =>
  ({
    id,
    name: id,
    type: 'doc',
    priority,
    description: `author ${id}`,
    parallelGroup: id,
    exclusive: false,
  }) as unknown as DesignTask;

/** The four handoff stages as the decompose contract assigns them. */
const BUNDLE = [
  docTask('guide', 100),
  docTask('tokens-colors', 110),
  docTask('entry-styles', 140),
  docTask('component-a-css', 200),
  docTask('component-b-css', 210),
  docTask('component-a-html', 300), // specimen — stage 3 after the fix
  docTask('screen-home', 310),
];

const bandOf = (priority: number): 1 | 2 | 3 => {
  const c = classify({ priority } as any);
  return c.isTokens ? 1 : c.isFoundation ? 2 : 3;
};

describe('doc band classification', () => {
  it.each([
    [100, 1],
    [140, 1],
    [199, 1],
    [200, 2],
    [249, 2],
    [299, 2],
    [300, 3],
    [349, 3],
  ])('priority %i is stage %i', (priority, expected) => {
    expect(bandOf(priority)).toBe(expected);
  });

  it('a specimen at 300 is gated by the spec barrier, not the assets barrier', () => {
    const c = classify({ priority: 300 } as any);
    expect(c).toEqual({ isTokens: false, isFoundation: false });
  });
});

describe('TaskOrchestrator — design stage barriers gate each band', () => {
  it('S1/S2/S3: no band overlap while a lower band is running, and the queue drains', async () => {
    const queue = new TaskQueue<DesignTask>();
    for (const t of BUNDLE) queue.push(t);

    /** Bands with at least one task currently executing. */
    const running = new Set<string>();
    const overlaps: string[] = [];

    const builder = () => ({
      invoke: vi.fn(async (state: any) => {
        const task = state.currentTask;
        const band = bandOf(task.priority);
        running.add(task.id);

        // Any concurrently-running task from a LOWER band is a barrier breach.
        for (const otherId of running) {
          if (otherId === task.id) continue;
          const other = BUNDLE.find(t => t.id === otherId)!;
          if (bandOf(other.priority) < band) {
            overlaps.push(`${task.id}(stage ${band}) ran while ${otherId}(stage ${bandOf(other.priority)}) was running`);
          }
        }

        // Hold the slot so a barrier breach has a window to be observed.
        await new Promise(r => setTimeout(r, 40));
        running.delete(task.id);
        return { ...state, _taskCompleted: true };
      }),
    });

    const orchestrator = new TaskOrchestrator<DesignTask>(
      queue,
      builder as any,
      {},
      {},
      { maxWorkers: 3, checkpointInterval: 0, barriers: { assets: true, spec: true } },
    );

    const result = await Promise.race([
      orchestrator.run(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('orchestrator hung — design stage barrier deadlock')), 8000),
      ),
    ]);

    expect(overlaps).toEqual([]);
    expect(result.failedTasks.length).toBe(0);
    expect(result.remainingQueue.length).toBe(0);
    expect(result.completedTasks.length).toBe(BUNDLE.length);

    // The specimen must complete after the component css it composes.
    const ids = result.completedTasks.map(t => t.id);
    expect(ids.indexOf('component-a-html')).toBeGreaterThan(ids.indexOf('component-a-css'));
    expect(ids.indexOf('component-a-html')).toBeGreaterThan(ids.indexOf('component-b-css'));
  });

  it('a specimen left at stage 2 races its own css — the shape the fix retires', async () => {
    // Same bundle with the specimen back at 201. Both land in the assets band,
    // so nothing orders them: this documents WHY the priority moved.
    expect(bandOf(201)).toBe(bandOf(200));
  });
});
