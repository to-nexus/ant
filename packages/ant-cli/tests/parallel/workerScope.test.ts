/**
 * `workerScope` — AsyncLocalStorage scoping for parallel TaskWorkers.
 *
 * Guards the two-dimensional scope contract used by `TurnContext.getWorkerScopeKey()`:
 *
 *   - `runInWorkerScope(workerId, …)` stamps the long-lived TaskWorker
 *     identity onto the async context.
 *   - `runInTaskScope(taskKey, …)` overlays the currently-executing
 *     task on top of the worker context, inheriting `workerId`.
 *
 * Why: the FE projector groups chat events into per-task sections via
 * the composed `worker-N#task-K` key. Without per-task scope, a
 * long-lived worker handling cohort 1 then cohort 2 tasks would fold
 * cohort-2 messages into cohort-1's pinned screen position (the
 * `rigid-fanning-faith` regression).
 */

import { describe, it, expect } from 'vitest';

import {
  getWorkerScope,
  runInTaskScope,
  runInWorkerScope,
} from '../../src/core/parallel/workerScope';
import { TurnContext } from '../../src/core/llm-response/TurnContext';

describe('workerScope', () => {
  it('returns undefined outside any scope', () => {
    expect(getWorkerScope()).toBeUndefined();
  });

  it('stamps `workerId` inside `runInWorkerScope`', async () => {
    await runInWorkerScope(7, async () => {
      const scope = getWorkerScope();
      expect(scope?.workerId).toBe(7);
      expect(scope?.taskKey).toBeUndefined();
    });
  });

  it('overlays `taskKey` while preserving `workerId` inside nested `runInTaskScope`', async () => {
    await runInWorkerScope(3, async () => {
      await runInTaskScope('task-A', async () => {
        const inner = getWorkerScope();
        expect(inner?.workerId).toBe(3);
        expect(inner?.taskKey).toBe('task-A');
      });
      // After the nested scope unwinds, taskKey is gone but workerId remains.
      const outer = getWorkerScope();
      expect(outer?.workerId).toBe(3);
      expect(outer?.taskKey).toBeUndefined();
    });
  });

  it('replaces `taskKey` on a second `runInTaskScope` call within the same worker', async () => {
    await runInWorkerScope(3, async () => {
      await runInTaskScope('task-A', async () => {
        expect(getWorkerScope()?.taskKey).toBe('task-A');
      });
      await runInTaskScope('task-B', async () => {
        expect(getWorkerScope()?.taskKey).toBe('task-B');
        expect(getWorkerScope()?.workerId).toBe(3);
      });
    });
  });

  it('runInTaskScope without a surrounding worker scope still executes fn (defensive fallback)', async () => {
    let ran = false;
    await runInTaskScope('orphan-task', async () => {
      ran = true;
      // No worker context → `getWorkerScope()` stays undefined so
      // `TurnContext` treats this branch as `_main_`.
      expect(getWorkerScope()).toBeUndefined();
    });
    expect(ran).toBe(true);
  });
});

describe('TurnContext.getWorkerScopeKey', () => {
  function makeContext(): TurnContext {
    return new TurnContext({
      projectId: 'proj',
      featureName: 'feat',
      jobId: 'job-1',
    });
  }

  it('returns `_main_` outside any scope', () => {
    const ctx = makeContext();
    expect(ctx.getWorkerScopeKey()).toBe('_main_');
  });

  it('returns `worker-N` when only worker scope is active', async () => {
    const ctx = makeContext();
    await runInWorkerScope(5, async () => {
      expect(ctx.getWorkerScopeKey()).toBe('worker-5');
    });
  });

  it('returns `worker-N#task-K` when both worker and task scopes are active', async () => {
    const ctx = makeContext();
    await runInWorkerScope(2, async () => {
      await runInTaskScope('task-XYZ', async () => {
        expect(ctx.getWorkerScopeKey()).toBe('worker-2#task-XYZ');
      });
    });
  });

  it('reverts to `worker-N` after the task scope unwinds', async () => {
    const ctx = makeContext();
    await runInWorkerScope(2, async () => {
      await runInTaskScope('task-XYZ', async () => {
        expect(ctx.getWorkerScopeKey()).toBe('worker-2#task-XYZ');
      });
      expect(ctx.getWorkerScopeKey()).toBe('worker-2');
    });
  });
});
