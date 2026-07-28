/**
 * Process-local registry of in-flight per-attempt LLM AbortControllers,
 * keyed by the AsyncLocalStorage workerId (workerScope). Lets the
 * orchestrator's stall watchdog sever a wedged worker's live stream
 * attempt so the failure propagates through the worker's own catch path
 * (reportFailure → retry budget) instead of being reported from outside.
 *
 * NOT Redis SSOT state — these are runtime handles only (same class as
 * the jobAbort module registry), scoped to this job-runner process.
 */

import { getWorkerScope } from './workerScope';

type ScopeKey = number | '_main_';

const attempts = new Map<ScopeKey, Set<AbortController>>();

function currentScopeKey(): ScopeKey {
  return getWorkerScope()?.workerId ?? '_main_';
}

/**
 * Register an in-flight stream attempt under the current worker scope.
 * Returns an unregister closure — callers MUST invoke it when the
 * attempt settles (success, error, or abort) or the handle leaks.
 */
export function registerStreamAttempt(controller: AbortController): () => void {
  const key = currentScopeKey();
  let set = attempts.get(key);
  if (!set) {
    set = new Set();
    attempts.set(key, set);
  }
  set.add(controller);
  return () => {
    set.delete(controller);
    if (set.size === 0) attempts.delete(key);
  };
}

/**
 * Abort every in-flight stream attempt registered under `workerId`.
 * Returns the number of attempts severed (0 = the stall is outside the
 * LLM layer — caller should observe, not kill).
 */
export function abortWorkerStreamAttempts(workerId: number, reason: Error): number {
  const set = attempts.get(workerId);
  if (!set || set.size === 0) return 0;
  let count = 0;
  for (const controller of set) {
    controller.abort(reason);
    count++;
  }
  return count;
}
