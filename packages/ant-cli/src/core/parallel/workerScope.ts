/**
 * WorkerScope - AsyncLocalStorage-based per-worker context isolation
 *
 * Enables parallel TaskWorkers to maintain independent message state
 * without modifying any calling code. SessionStore and ChatAPIClient
 * call getWorkerScope() to determine if execution is inside a worker.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

interface WorkerContext {
  workerId: number;
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
 * Retrieve the current worker context, or undefined if not inside a worker.
 */
export function getWorkerScope(): WorkerContext | undefined {
  return workerStorage.getStore();
}
