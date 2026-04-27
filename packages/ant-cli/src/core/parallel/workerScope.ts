/**
 * WorkerScope - AsyncLocalStorage-based per-worker / per-task context isolation
 *
 * Enables parallel TaskWorkers to maintain independent message state
 * without modifying any calling code. SessionStore and ChatAPIClient
 * call getWorkerScope() to determine if execution is inside a worker.
 *
 * Two dimensions live on the same storage:
 *   - `workerId`  — the long-lived TaskWorker identity (loop unit).
 *   - `taskKey?`  — the currently-executing task within that worker.
 *
 * Why both: a TaskWorker is a long-lived loop that picks up tasks across
 * barrier cohorts (UI cohort, then test-code cohort, …). Without
 * `taskKey`, every chat event from worker N folds into a single FE
 * section pinned to N's first chronological position — so cohort 2
 * messages get rendered ABOVE already-finished cohort 1 messages on
 * other workers (cf. `rigid-fanning-faith` regression). Stamping each
 * event with `worker-N#task-K` lets the FE projector split per task and
 * sort sections by first-event timestamp, restoring chronology.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

interface WorkerContext {
  workerId: number;
  taskKey?: string;
}

const workerStorage = new AsyncLocalStorage<WorkerContext>();

/**
 * Execute fn inside a worker-scoped async context.
 * All downstream async code (LangGraph invoke, LLM streaming, file ops)
 * will see the workerId via getWorkerScope().
 */
export function runInWorkerScope<T>(workerId: number, fn: () => Promise<T>): Promise<T> {
  return workerStorage.run({ workerId }, fn);
}

/**
 * Execute fn inside a task-scoped async context that inherits the
 * surrounding `workerId` and overlays `taskKey`. Must be called from
 * within `runInWorkerScope` (otherwise there's no worker to inherit).
 *
 * If called without an active worker scope (defensive fallback) the
 * task scope still runs but `getWorkerScope()` will return undefined,
 * which downstream callers (TurnContext.getWorkerScopeKey) treat as
 * `_main_` — same as today's no-worker path.
 */
export function runInTaskScope<T>(taskKey: string, fn: () => Promise<T>): Promise<T> {
  const prev = workerStorage.getStore();
  if (!prev) {
    // No worker context — invoke fn directly. Caller is responsible for
    // also setting up the worker scope when they need per-worker
    // isolation; this branch keeps `runInTaskScope` total.
    return fn();
  }
  return workerStorage.run({ ...prev, taskKey }, fn);
}

/**
 * Retrieve the current worker context, or undefined if not inside a worker.
 */
export function getWorkerScope(): WorkerContext | undefined {
  return workerStorage.getStore();
}
