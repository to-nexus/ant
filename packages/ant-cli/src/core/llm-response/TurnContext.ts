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
   * Stable worker-scope key used for `TURN_BUFFER` namespacing.
   *
   *   - main graph                → `_main_`
   *   - parallel TaskWorker N     → `worker-N`
   *
   * This mirrors the AsyncLocalStorage-based isolation the legacy
   * `SessionStore` used so parallel workers continue to maintain
   * independent in-flight streams.
   */
  getWorkerScopeKey(): string {
    const scope = getWorkerScope();
    return scope ? `worker-${scope.workerId}` : '_main_';
  }
}
