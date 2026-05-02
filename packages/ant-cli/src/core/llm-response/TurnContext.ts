/**
 * TurnContext — minimal session/worker context for the chat SSOT pipeline.
 *
 * Replaces the legacy {@link ../../core/llm-response/SessionStore.ts} which
 * carried a `messages[]` / `currentMessage` chat scratchpad. After the chat
 * SSOT rewrite (Phase 5) the worker no longer maintains that scratchpad —
 * `chat.jsonl` owns finalized lines and Redis `TURN_BUFFER` owns in-flight
 * streaming. This class therefore only tracks routing keys (projectId,
 * featureName, jobId, sessionKey, userContext) and a stable per-worker
 * scope key for buffering.
 */
import type { LLMResponseEnv, SessionContext } from './types';
import { getSessionKey } from '../chat/schema';
import { getWorkerScope } from '../parallel/workerScope';

export class TurnContext {
  readonly context: SessionContext;

  constructor(env: LLMResponseEnv) {
    const userContext =
      env.userId && env.organizationId
        ? { userId: env.userId, organizationId: env.organizationId }
        : undefined;

    this.context = {
      projectId: env.projectId,
      featureName: env.featureName,
      jobId: env.jobId,
      userContext,
      sessionKey: getSessionKey(env.projectId, env.featureName, userContext),
    };
  }

  getContext(): SessionContext {
    return this.context;
  }

  /**
   * Stable worker-scope key used for `TURN_BUFFER` namespacing AND
   * for the FE projector's per-task section grouping.
   *
   *   - main graph                       → `_main_`
   *   - parallel worker, no task         → `worker-N`
   *   - parallel worker, in a task       → `worker-N#task-K`
   *   - parallel worker, in a task,
   *     resumed cycle K                  → `worker-N#task-K#p{cycleSeq}`
   *
   * `task-K` is the task's stable id (or `name` fallback) set via
   * `runInTaskScope` inside `TaskWorker.executeTask`. Including it
   * partitions a long-lived worker's chat events per task so the FE
   * can sort sections by first-event timestamp — restoring chronology
   * when the same worker handles tasks across barrier cohorts.
   *
   * `cycleSeq` is the per-(turn, task) lifecycle entry index
   * managed by `StateStorePort.nextWorkerCycleSeq`. On the first
   * attempt the value is 0 and the suffix is elided — the resulting
   * key matches the legacy two-axis form, so existing buffers and
   * chat.jsonl events stay schema-compatible. Every re-entry source
   * (user Stop/Resume, batchSplit Path A re-queue, orchestrator
   * transient retry) bumps the suffix (`#p1`, `#p2`, …), minting a
   * fresh FE section AND a fresh `LLMResponseService.WorkerLocalState`
   * slot. The fresh slot is what eliminates stale `fileCardByPath` /
   * `commandCardByCommand` / `thinking` carry-over between cycles
   * (verification re-entry stale-card RCA). The fresh section is what
   * backs the chronology guarantee in
   * docs/architecture/31-chat-system.md §섹션-정렬 rule 4 — without
   * the suffix, cancelled cards (`_cancelled_:{cardId}`) get sorted
   * BELOW the worker section even after Resume, which is the
   * `even-getting-knave` regression.
   */
  getWorkerScopeKey(): string {
    const scope = getWorkerScope();
    if (!scope) return '_main_';
    const base = scope.taskKey
      ? `worker-${scope.workerId}#${scope.taskKey}`
      : `worker-${scope.workerId}`;
    if (scope.cycleSeq && scope.cycleSeq > 0) {
      return `${base}#p${scope.cycleSeq}`;
    }
    return base;
  }
}
