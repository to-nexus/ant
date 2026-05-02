/**
 * WorkerScope - AsyncLocalStorage-based per-worker / per-task context isolation
 *
 * Enables parallel TaskWorkers to maintain independent message state
 * without modifying any calling code. SessionStore and ChatAPIClient
 * call getWorkerScope() to determine if execution is inside a worker.
 *
 * Three dimensions live on the same storage:
 *   - `workerId`   — the long-lived TaskWorker identity (loop unit).
 *   - `taskKey?`   — the currently-executing task within that worker.
 *   - `cycleSeq?`  — the task lifecycle entry cycle (0 on first
 *                    attempt; bumped on every re-entry — see below).
 *
 * Why three: a TaskWorker is a long-lived loop that picks up tasks
 * across barrier cohorts (UI cohort, then test-code cohort, …). Without
 * `taskKey`, every chat event from worker N folds into a single FE
 * section pinned to N's first chronological position — so cohort 2
 * messages get rendered ABOVE already-finished cohort 1 messages on
 * other workers (cf. `rigid-fanning-faith` regression). Stamping each
 * event with `worker-N#task-K` lets the FE projector split per task and
 * sort sections by first-event timestamp, restoring chronology.
 *
 * Without `cycleSeq`, a task that survives a re-entry (Stop/Resume,
 * batchSplit Path A re-queue, orchestrator transient retry) reuses the
 * same `worker-N#task-K` scope, which causes two distinct failures:
 *   (a) FE section anchoring — cycle 1, 2, 3 collapse into one FE
 *       section whose first ts is pinned to cycle 1's start.
 *       Cancelled cards (`_cancelled_:{cardId}`) mint at the Stop ts,
 *       which is *later* than the worker's first ts, so the cancelled
 *       section sorts BELOW the worker section even after Resume —
 *       the `even-getting-knave` regression.
 *   (b) `LLMResponseService.WorkerLocalState` slot reuse — the
 *       service keys its per-worker `fileCardByPath` /
 *       `commandCardByCommand` / `thinking` caches by the same scope
 *       string. Without a fresh suffix, the second cycle inherits the
 *       first cycle's stale cardIds, so terminal `chat_status` events
 *       carry old ids and the FE folds them into the prior cycle's
 *       card position (verification re-entry stale-card RCA — the
 *       user sees a file/command/thinking card in scrollback being
 *       updated by the new cycle's output).
 *
 * Stamping each re-entry as `worker-N#task-K#p{cycleSeq}` mints a
 * fresh FE section AND a fresh WorkerLocalState slot per cycle.
 * `TaskWorker.executeTask` owns the INCR side
 * (`StateStorePort.nextWorkerCycleSeq(turnId, taskKey)`) and triggers
 * it on any re-entry marker, so all three re-entry sources converge
 * on the same SSOT. See chat-SSOT §섹션-정렬 rule 4.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

interface WorkerContext {
  workerId: number;
  taskKey?: string;
  /**
   * Task lifecycle entry cycle. 0 (or undefined) on the first
   * attempt; equals the per-(turn, task) INCR value returned by
   * `StateStorePort.nextWorkerCycleSeq` on every subsequent re-entry
   * (Stop+Resume / batchSplit Path A / orchestrator transient retry).
   * Set at worker entry by `TaskWorker.executeTask`.
   */
  cycleSeq?: number;
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
 * surrounding `workerId` and overlays `taskKey` (and optionally
 * `cycleSeq`). Must be called from within `runInWorkerScope`
 * (otherwise there's no worker to inherit).
 *
 * If called without an active worker scope (defensive fallback) the
 * task scope still runs but `getWorkerScope()` will return undefined,
 * which downstream callers (TurnContext.getWorkerScopeKey) treat as
 * `_main_` — same as today's no-worker path.
 *
 * Two-arg form `runInTaskScope(taskKey, fn)` is preserved for
 * backward-compatible call sites that have no resume-cycle awareness;
 * three-arg form `runInTaskScope(taskKey, cycleSeq, fn)` mints a
 * cycle-aware scope. `cycleSeq <= 0` is treated as "no suffix" so the
 * first-attempt key stays `worker-N#task-K` (no schema break).
 */
export function runInTaskScope<T>(taskKey: string, fn: () => Promise<T>): Promise<T>;
export function runInTaskScope<T>(
  taskKey: string,
  cycleSeq: number,
  fn: () => Promise<T>,
): Promise<T>;
export function runInTaskScope<T>(
  taskKey: string,
  arg2: number | (() => Promise<T>),
  arg3?: () => Promise<T>,
): Promise<T> {
  const cycleSeq = typeof arg2 === 'number' ? arg2 : 0;
  const fn = (typeof arg2 === 'function' ? arg2 : arg3) as () => Promise<T>;
  const prev = workerStorage.getStore();
  if (!prev) {
    // No worker context — invoke fn directly. Caller is responsible for
    // also setting up the worker scope when they need per-worker
    // isolation; this branch keeps `runInTaskScope` total.
    return fn();
  }
  const next: WorkerContext = { ...prev, taskKey };
  if (cycleSeq > 0) next.cycleSeq = cycleSeq;
  return workerStorage.run(next, fn);
}

/**
 * Retrieve the current worker context, or undefined if not inside a worker.
 */
export function getWorkerScope(): WorkerContext | undefined {
  return workerStorage.getStore();
}
