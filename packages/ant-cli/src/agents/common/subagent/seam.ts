/**
 * Subagent seam — the per-job capture that makes the job-blind runner work.
 * Built inside each job's tool-context assembly (tool node buildContext /
 * decompose inline ctx / direct node ctx) and attached as `ctx.subagent`.
 */

import { getWorkerScope } from '../../../core/parallel/workerScope';
import { buildLaunchAck } from './drain';
import { launchEntry } from './registry';
import { runExploreSubagent } from './SubagentRunner';
import type { SubagentSeam, SubagentSeamInternals } from './types';

/**
 * Mirrors TurnContext.getWorkerScopeKey (core/llm-response/TurnContext.ts) —
 * the chat-scope SSOT for worker/task attribution. Reimplemented here because
 * TurnContext is bound to the LLMResponseService lifecycle.
 */
export function workerScopeKey(): string {
  const scope = getWorkerScope();
  if (!scope) return '_main_';
  const base = scope.taskKey
    ? `worker-${scope.workerId}#${scope.taskKey}`
    : `worker-${scope.workerId}`;
  return scope.cycleSeq && scope.cycleSeq > 0 ? `${base}#p${scope.cycleSeq}` : base;
}

export function ownerKeyFor(jobId: string | undefined): string {
  return `${jobId ?? 'nojob'}:${workerScopeKey()}`;
}

export function createSubagentSeam(
  params: { jobId?: string } & SubagentSeamInternals,
): SubagentSeam {
  const ownerKey = ownerKeyFor(params.jobId);
  return {
    ownerKey,
    jobKind: params.jobKind,
    async launch(callId, goal, hints) {
      if (!goal || typeof goal !== 'string' || goal.trim().length === 0) {
        return { denied: 'Error: explore requires a non-empty `goal` string.' };
      }
      let chatCardId: string | undefined;
      try {
        const { getChatAPIClient } = await import('../../../core/adapters/ChatAPIClient');
        chatCardId = await getChatAPIClient().subagentStart(callId, goal);
      } catch (err) {
        console.warn('⚠️ [Subagent] launch card emit failed:', (err as Error).message);
      }
      const launched = launchEntry({
        id: callId,
        ownerKey,
        goal,
        run: () =>
          runExploreSubagent({ id: callId, goal, hints, internals: params, chatCardId }),
      });
      if ('denied' in launched) {
        // Resolve the dangling spinner card if one was minted.
        try {
          const { getChatAPIClient } = await import('../../../core/adapters/ChatAPIClient');
          await getChatAPIClient().subagentComplete(chatCardId, {
            subagentId: callId,
            goal,
            state: 'error',
            error: launched.denied,
          });
        } catch { /* card cleanup is best-effort */ }
        return launched;
      }
      launched.chatCardId = chatCardId;
      console.log(`🧭 [Subagent] Launched explore ${callId} (owner: ${ownerKey}): ${goal.slice(0, 120)}`);
      return { ack: buildLaunchAck(callId, goal) };
    },
  };
}
