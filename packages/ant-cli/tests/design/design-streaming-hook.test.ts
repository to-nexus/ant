/**
 * Regression coverage for `createDesignTaskStreamingHook` —
 * the closure-scoped accumulator that surfaces each `<task>` body as
 * the design decompose tool-loop streams it.
 *
 * The hook is the design-side analogue of code decompose's
 * `accumulatedTasks` / `broadcastAccumulated` pattern. It must:
 *   - parse the streamed JSON (with prose / fence tolerance),
 *   - dedupe by `id`,
 *   - skip malformed bodies silently (final parse will surface gaps),
 *   - broadcast the cumulative queue on every accepted task,
 *   - reset cleanly for the system-design repair-call path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DesignGraphState } from '../../src/agents/architect/graph/design/state';
import { createDesignTaskStreamingHook } from '../../src/agents/architect/graph/design/nodes/decompose/kanbanUpdate';

type UpdateTaskQueueSpy = ReturnType<typeof vi.fn>;

function mkState(): { state: DesignGraphState; spy: UpdateTaskQueueSpy } {
  const spy = vi.fn();
  const state = {
    _httpJobId: 'job-1',
    deps: {
      kanbanUpdate: {
        updateTaskQueue: spy,
      },
    },
  } as unknown as DesignGraphState;
  return { state, spy };
}

describe('createDesignTaskStreamingHook', () => {
  let state: DesignGraphState;
  let spy: UpdateTaskQueueSpy;

  beforeEach(() => {
    ({ state, spy } = mkState());
  });

  it('accumulates parsed tasks and broadcasts after every accepted body', () => {
    const hook = createDesignTaskStreamingHook(state);

    hook.onTaskParsed('{"id":"t1","name":"first","priority":100,"description":"d1","targetFile":"f.md"}');
    hook.onTaskParsed('{"id":"t2","name":"second","priority":200,"description":"d2","targetFile":"f.md"}');

    expect(spy).toHaveBeenCalledTimes(2);
    const lastCall = spy.mock.calls[spy.mock.calls.length - 1];
    const queueArg = lastCall[2]; // (jobId, currentTask, queue, completed, recursion, _)
    expect(queueArg.map((t: any) => t.id)).toEqual(['t1', 't2']);
  });

  it('dedupes by `id` — second occurrence is dropped without re-broadcasting', () => {
    const hook = createDesignTaskStreamingHook(state);

    hook.onTaskParsed('{"id":"t1","name":"first","priority":100,"description":"d","targetFile":"f.md"}');
    hook.onTaskParsed('{"id":"t1","name":"first-dupe","priority":999,"description":"d","targetFile":"f.md"}');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(hook.getAccumulated()).toHaveLength(1);
    expect(hook.getAccumulated()[0].name).toBe('first');
  });

  it('skips bodies with malformed JSON without aborting', () => {
    const hook = createDesignTaskStreamingHook(state);

    hook.onTaskParsed('totally not JSON');
    hook.onTaskParsed('{"id":"t1","name":"first","priority":100,"description":"d","targetFile":"f.md"}');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(hook.getAccumulated().map(t => t.id)).toEqual(['t1']);
  });

  it('skips bodies missing `id` or `name` (contract violation, surfaces downstream)', () => {
    const hook = createDesignTaskStreamingHook(state);

    hook.onTaskParsed('{"name":"no-id","priority":100,"description":"d","targetFile":"f.md"}');
    hook.onTaskParsed('{"id":"no-name","priority":100,"description":"d","targetFile":"f.md"}');
    hook.onTaskParsed('{"id":"good","name":"good","priority":100,"description":"d","targetFile":"f.md"}');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(hook.getAccumulated().map(t => t.id)).toEqual(['good']);
  });

  it('tolerates trailing prose around the JSON body (regression: prose-leak class)', () => {
    const hook = createDesignTaskStreamingHook(state);
    const noisy = [
      '> Reasoning: this seeds the architecture.',
      '{"id":"t1","name":"first","priority":100,"description":"d","targetFile":"f.md"}',
      'tail prose that must not break parsing.',
    ].join('\n');

    hook.onTaskParsed(noisy);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(hook.getAccumulated().map(t => t.id)).toEqual(['t1']);
  });

  it('reset() clears the buffer and broadcasts the empty queue (system-design repair path)', () => {
    const hook = createDesignTaskStreamingHook(state);

    hook.onTaskParsed('{"id":"t1","name":"first","priority":100,"description":"d","targetFile":"f.md"}');
    hook.onTaskParsed('{"id":"t2","name":"second","priority":200,"description":"d","targetFile":"f.md"}');
    expect(hook.getAccumulated()).toHaveLength(2);

    spy.mockClear();
    hook.reset();

    expect(hook.getAccumulated()).toHaveLength(0);
    expect(spy).toHaveBeenCalledTimes(1);
    const resetCall = spy.mock.calls[0];
    expect(resetCall[2]).toEqual([]); // queue is empty after reset
  });

  it('reset() is a no-op when the buffer is already empty (no extra broadcast)', () => {
    const hook = createDesignTaskStreamingHook(state);
    hook.reset();
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it('is a no-op when state has no `_httpJobId` (e.g. CLI / test harness)', () => {
    const localSpy = vi.fn();
    const headlessState = {
      deps: { kanbanUpdate: { updateTaskQueue: localSpy } },
    } as unknown as DesignGraphState;
    const hook = createDesignTaskStreamingHook(headlessState);

    hook.onTaskParsed('{"id":"t1","name":"first","priority":100,"description":"d","targetFile":"f.md"}');

    expect(localSpy).not.toHaveBeenCalled();
    expect(hook.getAccumulated().map(t => t.id)).toEqual(['t1']);
  });

  it('is a no-op when `state.deps.kanbanUpdate` is missing (broadcast suppressed, accumulator still works)', () => {
    const headlessState = { _httpJobId: 'job-1' } as unknown as DesignGraphState;
    const hook = createDesignTaskStreamingHook(headlessState);

    hook.onTaskParsed('{"id":"t1","name":"first","priority":100,"description":"d","targetFile":"f.md"}');

    expect(hook.getAccumulated().map(t => t.id)).toEqual(['t1']);
  });

  it('default-fills priority/description/targetFile when the streamed body is partial', () => {
    const hook = createDesignTaskStreamingHook(state);
    hook.onTaskParsed('{"id":"t1","name":"first"}');

    const t = hook.getAccumulated()[0];
    expect(t.id).toBe('t1');
    expect(t.name).toBe('first');
    expect(t.type).toBe('doc');
    expect(t.priority).toBe(250);
    expect(t.description).toBe('');
    expect(t.targetFile).toBeUndefined();
    expect(t.completed).toBe(false);
  });
});
